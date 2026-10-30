/* GramCare AI - portable C HTTP server (educational prototype) */
#ifdef _WIN32
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib,"ws2_32.lib")
typedef SOCKET sock_t;
#define CLOSESOCK closesocket
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
typedef int sock_t;
#define INVALID_SOCKET (-1)
#define SOCKET_ERROR (-1)
#define CLOSESOCK close
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#define PORT 8080
#define BUF 65536

typedef struct { char id[20], name[80], village[80], mobile[20], flag[16]; int age; } Patient;
static Patient patients[200]; static int patient_count=0;

static void seed(void){
 Patient p[]={
 {"GC-1001","Sunita Devi","Sahaspur","9000000001","NORMAL",34},
 {"GC-1002","Ramesh Negi","Chakrata","9000000002","URGENT",61},
 {"GC-1003","Kavita Rawat","Doiwala","9000000003","REVIEW",27}};
 memcpy(patients,p,sizeof(p)); patient_count=3;
}
static int get_num(const char*b,const char*k,int def){char pat[80],*p;snprintf(pat,sizeof pat,"\"%s\":",k);p=strstr(b,pat);return p?atoi(p+strlen(pat)):def;}
static double get_double(const char*b,const char*k,double def){char pat[80],*p;snprintf(pat,sizeof pat,"\"%s\":",k);p=strstr(b,pat);return p?atof(p+strlen(pat)):def;}
static void get_str(const char*b,const char*k,char*out,size_t n){char pat[80],*p,*e;out[0]=0;snprintf(pat,sizeof pat,"\"%s\":\"",k);p=strstr(b,pat);if(!p)return;p+=strlen(pat);e=strchr(p,'\"');if(!e)return;size_t z=(size_t)(e-p);if(z>=n)z=n-1;memcpy(out,p,z);out[z]=0;}
static const char* edge(double hr,double sp,double tp){if(hr<30||hr>220||sp<50||sp>100||tp<30||tp>45)return "INVALID";if(sp<90||hr>130||hr<45||tp>=39.5)return "URGENT";if(sp<94||hr>100||hr<55||tp>=38)return "REVIEW";return "NORMAL";}
static const char* mime(const char*p){const char*e=strrchr(p,'.');if(!e)return "text/plain";if(!strcmp(e,".html"))return "text/html; charset=utf-8";if(!strcmp(e,".css"))return "text/css";if(!strcmp(e,".js"))return "application/javascript";if(!strcmp(e,".json"))return "application/json";if(!strcmp(e,".svg"))return "image/svg+xml";return "application/octet-stream";}
static void send_resp(sock_t c,int code,const char*type,const char*body){char h[512];int n=snprintf(h,sizeof h,"HTTP/1.1 %d OK\r\nContent-Type: %s\r\nContent-Length: %zu\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",code,type,strlen(body));send(c,h,n,0);send(c,body,(int)strlen(body),0);}
static void send_file(sock_t c,const char*path){FILE*f=fopen(path,"rb");if(!f){send_resp(c,404,"text/plain","Not found");return;}fseek(f,0,SEEK_END);long z=ftell(f);rewind(f);char*h=malloc((size_t)z+1);fread(h,1,(size_t)z,f);fclose(f);h[z]=0;char hd[512];int n=snprintf(hd,sizeof hd,"HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %ld\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",mime(path),z);send(c,hd,n,0);send(c,h,(int)z,0);free(h);}
static void serve(sock_t c,const char*u){char p[300],*q;if(strstr(u,"..")||strchr(u,'\\')){send_resp(c,400,"text/plain","Bad path");return;}snprintf(p,sizeof p,"public%s",strcmp(u,"/")?u:"/index.html");if((q=strchr(p,'?')))*q=0;send_file(c,p);}
static void api(sock_t c,const char*method,const char*path,const char*body){char out[BUF];
 if(!strcmp(path,"/api/health")){send_resp(c,200,"application/json","{\"ok\":true,\"backend\":\"C\",\"name\":\"GramCare AI\"}");return;}
 if(!strcmp(path,"/api/vitals")&&!strcmp(method,"POST")){double hr=get_double(body,"hr",0),sp=get_double(body,"spo2",0),tp=get_double(body,"temp",0);const char*f=edge(hr,sp,tp);snprintf(out,sizeof out,"{\"flag\":\"%s\",\"message\":\"%s\"}",f,!strcmp(f,"INVALID")?"Re-check the measurement":"Attention flag only - not a diagnosis");send_resp(c,200,"application/json",out);return;}
 if(!strcmp(path,"/api/patients")&&!strcmp(method,"GET")){size_t o=0;o+=snprintf(out+o,sizeof(out)-o,"[");for(int i=0;i<patient_count;i++){Patient*p=&patients[i];o+=snprintf(out+o,sizeof(out)-o,"%s{\"id\":\"%s\",\"name\":\"%s\",\"age\":%d,\"village\":\"%s\",\"mobile\":\"%s\",\"flag\":\"%s\"}",i?",":"",p->id,p->name,p->age,p->village,p->mobile,p->flag);}snprintf(out+o,sizeof(out)-o,"]");send_resp(c,200,"application/json",out);return;}
 if(!strcmp(path,"/api/patients")&&!strcmp(method,"POST")){if(patient_count>=200){send_resp(c,400,"application/json","{\"error\":\"Patient limit reached\"}");return;}Patient*p=&patients[patient_count];get_str(body,"name",p->name,sizeof p->name);get_str(body,"village",p->village,sizeof p->village);get_str(body,"mobile",p->mobile,sizeof p->mobile);p->age=get_num(body,"age",-1);strcpy(p->flag,"NO READINGS");if(strlen(p->name)<2||p->age<0||p->age>120||strlen(p->village)<2||strlen(p->mobile)!=10){send_resp(c,400,"application/json","{\"error\":\"Invalid patient details\"}");return;}snprintf(p->id,sizeof p->id,"GC-%d",1001+patient_count);patient_count++;snprintf(out,sizeof out,"{\"ok\":true,\"id\":\"%s\"}",p->id);send_resp(c,200,"application/json",out);return;}
 if(!strcmp(path,"/api/medicines")){send_resp(c,200,"application/json","[{\"name\":\"Paracetamol 500 mg\",\"category\":\"Fever & pain\",\"price\":24,\"rx\":false},{\"name\":\"ORS Sachet\",\"category\":\"Hydration\",\"price\":22,\"rx\":false},{\"name\":\"Digital Thermometer\",\"category\":\"Devices\",\"price\":180,\"rx\":false},{\"name\":\"Pulse Oximeter\",\"category\":\"Devices\",\"price\":899,\"rx\":false},{\"name\":\"Amoxicillin\",\"category\":\"Prescription only\",\"price\":120,\"rx\":true}]");return;}
 if(!strcmp(path,"/api/emergency")&&!strcmp(method,"POST")){char name[80],problem[120];get_str(body,"name",name,sizeof name);get_str(body,"problem",problem,sizeof problem);snprintf(out,sizeof out,"{\"id\":\"SOS-%ld\",\"status\":\"SENT\",\"patient\":\"%s\",\"problem\":\"%s\",\"responder\":\"Nearest on-duty doctor / ASHA\",\"eta_min\":8}",(long)time(NULL),name,problem);send_resp(c,200,"application/json",out);return;}
 send_resp(c,404,"application/json","{\"error\":\"Unknown API route\"}");
}
int main(void){
#ifdef _WIN32
 WSADATA w; if(WSAStartup(MAKEWORD(2,2),&w)!=0)return 1;
#endif
 seed();sock_t s=socket(AF_INET,SOCK_STREAM,0);if(s==INVALID_SOCKET){perror("socket");return 1;}struct sockaddr_in a;memset(&a,0,sizeof a);a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_ANY);a.sin_port=htons(PORT);if(bind(s,(struct sockaddr*)&a,sizeof a)==SOCKET_ERROR){perror("bind");return 1;}listen(s,16);printf("GramCare C server: http://localhost:%d\nPress Ctrl+C to stop.\n",PORT);
 for(;;){sock_t c=accept(s,NULL,NULL);if(c==INVALID_SOCKET)continue;char*b=calloc(1,BUF);int n=recv(c,b,BUF-1,0);if(n<=0){free(b);CLOSESOCK(c);continue;}char method[8]={0},path[256]={0};sscanf(b,"%7s %255s",method,path);char*body=strstr(b,"\r\n\r\n");body=body?body+4:b+n;if(!strncmp(path,"/api/",5))api(c,method,path,body);else serve(c,path);free(b);CLOSESOCK(c);}
}
