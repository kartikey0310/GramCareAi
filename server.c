/* GramCare AI - portable C HTTP server, in-memory storage (educational prototype) */
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
#define MAX_PATIENTS 200
#define MAX_VITALS 500
#define MAX_ALERTS 200
#define MAX_MEDICINES 50
#define MAX_VOICE_SESSIONS 100
#define MAX_VOICE_MESSAGES 1000

typedef struct { char id[20], name[80], village[80], mobile[20], flag[16]; int age; } Patient;
static Patient patients[MAX_PATIENTS]; static int patient_count=0;

typedef struct { int id; int hr, spo2; double temp; char flag[16], message[300], issues[300]; } Vitals;
static Vitals vitals[MAX_VITALS]; static int vitals_count=0;

typedef struct { char id[32], name[80], problem[120], status[16], responder[80]; int eta_min; } Alert;
static Alert alerts[MAX_ALERTS]; static int alert_count=0;

typedef struct { char name[80], category[60]; int price; int rx; } Medicine;
static Medicine medicines[MAX_MEDICINES]; static int medicine_count=0;

typedef struct {
    char id[64];
    char title[128];
    char status[32];
    char last_prompt[1024];
    char created_at[64];
    char updated_at[64];
} VoiceSession;
static VoiceSession voice_sessions[MAX_VOICE_SESSIONS];
static int voice_session_count=0;

typedef struct {
    int id;
    char session_id[64];
    char sender[32];
    char text[2048];
    char lang[32];
    char created_at[64];
} VoiceMessage;
static VoiceMessage voice_messages[MAX_VOICE_MESSAGES];
static int voice_message_count=0;

static void get_iso_time(char*out,size_t n){
    time_t now=time(NULL);
    struct tm*tm_info=gmtime(&now);
    strftime(out,n,"%Y-%m-%dT%H:%M:%SZ",tm_info);
}

static void json_escape(const char*in, char*out, size_t max_len){
    if(!in){if(max_len>0)out[0]=0; return;}
    size_t j=0;
    for(size_t i=0; in[i] && j+2 < max_len; i++){
        unsigned char c = (unsigned char)in[i];
        if(c == '\"'){
            out[j++] = '\\'; out[j++] = '\"';
        } else if(c == '\\'){
            out[j++] = '\\'; out[j++] = '\\';
        } else if(c == '\n'){
            out[j++] = '\\'; out[j++] = 'n';
        } else if(c == '\r'){
            out[j++] = '\\'; out[j++] = 'r';
        } else if(c == '\t'){
            out[j++] = '\\'; out[j++] = 't';
        } else if(c < 32){
            /* skip unprintable control characters */
        } else {
            out[j++] = (char)c;
        }
    }
    out[j] = 0;
}

static void seed_medicines(void){
    Medicine m[]={
        {"Paracetamol 500 mg","Fever & pain",24,0},
        {"ORS Sachet","Hydration",22,0},
        {"Digital Thermometer","Devices",180,0},
        {"Pulse Oximeter","Devices",899,0},
        {"Amoxicillin","Prescription only",120,1}};
    memcpy(medicines,m,sizeof(m)); medicine_count=5;
}

/* ---- JSON request helpers ---- */
static int get_num(const char*b,const char*k,int def){char pat[80],*p;snprintf(pat,sizeof pat,"\"%s\":",k);p=strstr(b,pat);return p?atoi(p+strlen(pat)):def;}
static double get_double(const char*b,const char*k,double def){char pat[80],*p;snprintf(pat,sizeof pat,"\"%s\":",k);p=strstr(b,pat);return p?atof(p+strlen(pat)):def;}
static void get_str(const char*b,const char*k,char*out,size_t n){char pat[80],*p,*e;out[0]=0;snprintf(pat,sizeof pat,"\"%s\":\"",k);p=strstr(b,pat);if(!p)return;p+=strlen(pat);e=strchr(p,'\"');if(!e)return;size_t z=(size_t)(e-p);if(z>=n)z=n-1;memcpy(out,p,z);out[z]=0;}

static void assess_vitals(double hr,double sp,double tp,char*flag,char*msg,char*issues){
    strcpy(flag,"NORMAL"); strcpy(msg,"All vitals within normal range"); strcpy(issues,"");
    int urgent=0, review=0;
    char tmp[200]="";

    if(hr<30||hr>220||sp<50||sp>100||tp<30||tp>45){
        strcpy(flag,"INVALID"); strcpy(msg,"Re-check the measurement"); strcpy(issues,"Invalid reading");
        return;
    }
    if(hr<60){sprintf(tmp+strlen(tmp),"%sBradycardia (low heart rate)",strlen(tmp)?" · ":""); review=1;}
    else if(hr>100){sprintf(tmp+strlen(tmp),"%sTachycardia (high heart rate)",strlen(tmp)?" · ":""); review=1;}
    if(sp<90){sprintf(tmp+strlen(tmp),"%sSevere hypoxemia (very low SpO₂)",strlen(tmp)?" · ":""); urgent=1;}
    else if(sp<94){sprintf(tmp+strlen(tmp),"%sLow SpO₂",strlen(tmp)?" · ":""); review=1;}
    if(tp<35){sprintf(tmp+strlen(tmp),"%sHypothermia (low temperature)",strlen(tmp)?" · ":""); urgent=1;}
    else if(tp>=39.5){sprintf(tmp+strlen(tmp),"%sHyperpyrexia (very high fever)",strlen(tmp)?" · ":""); urgent=1;}
    else if(tp>=38){sprintf(tmp+strlen(tmp),"%sFever",strlen(tmp)?" · ":""); review=1;}

    if(urgent){strcpy(flag,"URGENT"); strcpy(msg,tmp);}
    else if(review){strcpy(flag,"REVIEW"); strcpy(msg,tmp);}
    else {strcpy(flag,"NORMAL"); strcpy(msg,"All vitals within normal range");}
    strcpy(issues,tmp);
}

static const char* mime(const char*p){const char*e=strrchr(p,'.');if(!e)return "text/plain";if(!strcmp(e,".html"))return "text/html; charset=utf-8";if(!strcmp(e,".css"))return "text/css";if(!strcmp(e,".js"))return "application/javascript";if(!strcmp(e,".json"))return "application/json";if(!strcmp(e,".svg"))return "image/svg+xml";return "application/octet-stream";}

static void send_resp(sock_t c,int code,const char*type,const char*body){
    char h[512];
    int n=snprintf(h,sizeof h,"HTTP/1.1 %d OK\r\nContent-Type: %s\r\nContent-Length: %zu\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",code,type,strlen(body));
    send(c,h,n,0);send(c,body,(int)strlen(body),0);
}
static void send_file(sock_t c,const char*path){
    FILE*f=fopen(path,"rb");
    if(!f){send_resp(c,404,"text/plain","Not found");return;}
    fseek(f,0,SEEK_END);long z=ftell(f);rewind(f);
    char*h=malloc((size_t)z+1);fread(h,1,(size_t)z,f);fclose(f);h[z]=0;
    char hd[512];int n=snprintf(hd,sizeof hd,"HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %ld\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",mime(path),z);
    send(c,hd,n,0);send(c,h,(int)z,0);free(h);
}
static void serve(sock_t c,const char*u){
    char p[300],*q;
    if(strstr(u,"..")||strchr(u,'\\')){send_resp(c,400,"text/plain","Bad path");return;}
    snprintf(p,sizeof p,"public%s",strcmp(u,"/")?u:"/index.html");
    if((q=strchr(p,'?')))*q=0;
    send_file(c,p);
}

static void api(sock_t c,const char*method,const char*path,const char*body){
    char out[BUF];

    /* ---- OPTIONS preflight ---- */
    if(!strcmp(method,"OPTIONS")){
        char h[512];
        snprintf(h,sizeof h,
            "HTTP/1.1 204 No Content\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
            "Connection: close\r\n\r\n");
        send(c,h,(int)strlen(h),0);
        return;
    }

    if(!strcmp(path,"/api/health")){
        send_resp(c,200,"application/json","{\"ok\":true,\"name\":\"GramCare AI\"}");
        return;
    }

    /* ---- Vitals ---- */
    if(!strcmp(path,"/api/vitals")&&!strcmp(method,"POST")){
        double hr=get_double(body,"hr",0),sp=get_double(body,"spo2",0),tp=get_double(body,"temp",0);
        char flag[16],msg[300],issues[300];
        assess_vitals(hr,sp,tp,flag,msg,issues);
        if(vitals_count<MAX_VITALS){
            Vitals*v=&vitals[vitals_count++];
            v->id=vitals_count; v->hr=(int)hr; v->spo2=(int)sp; v->temp=tp;
            strcpy(v->flag,flag); strcpy(v->message,msg); strcpy(v->issues,issues);
        }
        snprintf(out,sizeof out,"{\"flag\":\"%s\",\"message\":\"%s\",\"issues\":\"%s\"}",flag,msg,issues);
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Patients: list ---- */
    if(!strcmp(path,"/api/patients")&&!strcmp(method,"GET")){
        size_t o=0;o+=snprintf(out+o,sizeof(out)-o,"[");
        for(int i=0;i<patient_count;i++){
            Patient*p=&patients[i];
            if(i)o+=snprintf(out+o,sizeof(out)-o,",");
            o+=snprintf(out+o,sizeof(out)-o,
                "{\"id\":\"%s\",\"name\":\"%s\",\"age\":%d,\"village\":\"%s\",\"mobile\":\"%s\",\"flag\":\"%s\"}",
                p->id,p->name,p->age,p->village,p->mobile,p->flag);
        }
        snprintf(out+o,sizeof(out)-o,"]");
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Patients: create ---- */
    if(!strcmp(path,"/api/patients")&&!strcmp(method,"POST")){
        if(patient_count>=MAX_PATIENTS){send_resp(c,400,"application/json","{\"error\":\"Patient limit reached\"}");return;}
        Patient*p=&patients[patient_count];
        get_str(body,"name",p->name,sizeof p->name);
        get_str(body,"village",p->village,sizeof p->village);
        get_str(body,"mobile",p->mobile,sizeof p->mobile);
        p->age=get_num(body,"age",-1);
        strcpy(p->flag,"NO READINGS");
        if(strlen(p->name)<2||p->age<0||p->age>120||strlen(p->village)<2||strlen(p->mobile)!=10){
            send_resp(c,400,"application/json","{\"error\":\"Invalid patient details\"}");
            return;
        }
        /* Check for duplicate mobile */
        for(int i=0;i<patient_count;i++){
            if(strcmp(patients[i].mobile,p->mobile)==0){
                send_resp(c,400,"application/json","{\"error\":\"Patient with this mobile already exists\"}");
                return;
            }
        }
        snprintf(p->id,sizeof p->id,"GC-%d",1001+patient_count);
        patient_count++;
        snprintf(out,sizeof out,"{\"ok\":true,\"id\":\"%s\"}",p->id);
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Medicines: list ---- */
    if(!strcmp(path,"/api/medicines")){
        size_t o=0;o+=snprintf(out+o,sizeof(out)-o,"[");
        for(int i=0;i<medicine_count;i++){
            Medicine*m=&medicines[i];
            if(i)o+=snprintf(out+o,sizeof(out)-o,",");
            o+=snprintf(out+o,sizeof(out)-o,
                "{\"name\":\"%s\",\"category\":\"%s\",\"price\":%d,\"rx\":%s}",
                m->name,m->category,m->price,m->rx?"true":"false");
        }
        snprintf(out+o,sizeof(out)-o,"]");
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Emergency: create ---- */
    if(!strcmp(path,"/api/emergency")&&!strcmp(method,"POST")){
        char name[80]={0},problem[120]={0};
        get_str(body,"name",name,sizeof name);
        get_str(body,"problem",problem,sizeof problem);
        if(strlen(name)==0)strcpy(name,"Unknown patient");
        Alert*a=&alerts[alert_count++];
        snprintf(a->id,sizeof a->id,"SOS-%ld",(long)time(NULL));
        strcpy(a->name,name); strcpy(a->problem,problem);
        strcpy(a->status,"SENT"); strcpy(a->responder,"Nearest on-duty doctor / ASHA"); a->eta_min=8;
        snprintf(out,sizeof out,
            "{\"id\":\"%s\",\"status\":\"SENT\",\"patient\":\"%s\",\"problem\":\"%s\","
            "\"responder\":\"Nearest on-duty doctor / ASHA\",\"eta_min\":8}",
            a->id,name,problem);
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Voice session: get latest active session with messages ---- */
    if(!strcmp(path,"/api/voice/session/latest")&&!strcmp(method,"GET")){
        int latest_idx = -1;
        for(int i = voice_session_count - 1; i >= 0; i--){
            if(!strcmp(voice_sessions[i].status, "active")){
                int has_msg = 0;
                for(int m = 0; m < voice_message_count; m++){
                    if(!strcmp(voice_messages[m].session_id, voice_sessions[i].id)){
                        has_msg = 1;
                        break;
                    }
                }
                if(has_msg){
                    latest_idx = i;
                    break;
                }
            }
        }
        if(latest_idx < 0){
            send_resp(c,200,"application/json","{\"has_session\":false}");
            return;
        }
        VoiceSession*s = &voice_sessions[latest_idx];
        char esc_title[256], esc_prompt[2048];
        json_escape(s->title, esc_title, sizeof esc_title);
        json_escape(s->last_prompt, esc_prompt, sizeof esc_prompt);

        size_t o = 0;
        o += snprintf(out+o, sizeof(out)-o,
            "{\"has_session\":true,\"session\":{\"id\":\"%s\",\"title\":\"%s\",\"status\":\"%s\",\"last_prompt\":\"%s\",\"created_at\":\"%s\",\"updated_at\":\"%s\"},\"messages\":[",
            s->id, esc_title, s->status, esc_prompt, s->created_at, s->updated_at);

        int first = 1;
        for(int m = 0; m < voice_message_count && o + 2048 < sizeof(out); m++){
            if(!strcmp(voice_messages[m].session_id, s->id)){
                if(!first) o += snprintf(out+o, sizeof(out)-o, ",");
                first = 0;
                char esc_t[2048];
                json_escape(voice_messages[m].text, esc_t, sizeof esc_t);
                o += snprintf(out+o, sizeof(out)-o,
                    "{\"id\":%d,\"sender\":\"%s\",\"text\":\"%s\",\"lang\":\"%s\",\"created_at\":\"%s\"}",
                    voice_messages[m].id, voice_messages[m].sender, esc_t, voice_messages[m].lang, voice_messages[m].created_at);
            }
        }
        o += snprintf(out+o, sizeof(out)-o, "]}");
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Voice session: create new ---- */
    if(!strcmp(path,"/api/voice/session")&&!strcmp(method,"POST")){
        for(int i = 0; i < voice_session_count; i++){
            if(!strcmp(voice_sessions[i].status, "active")){
                strcpy(voice_sessions[i].status, "completed");
            }
        }
        if(voice_session_count >= MAX_VOICE_SESSIONS){
            memmove(&voice_sessions[0], &voice_sessions[1], sizeof(VoiceSession) * (MAX_VOICE_SESSIONS - 1));
            voice_session_count = MAX_VOICE_SESSIONS - 1;
        }
        VoiceSession*s = &voice_sessions[voice_session_count++];
        snprintf(s->id, sizeof s->id, "VS-%ld", (long)time(NULL));
        get_str(body, "title", s->title, sizeof s->title);
        if(strlen(s->title) == 0) strcpy(s->title, "Voice Health Consultation");
        strcpy(s->status, "active");
        strcpy(s->last_prompt, "");
        get_iso_time(s->created_at, sizeof s->created_at);
        strcpy(s->updated_at, s->created_at);

        char esc_title[256];
        json_escape(s->title, esc_title, sizeof esc_title);
        snprintf(out, sizeof out, "{\"ok\":true,\"session_id\":\"%s\",\"title\":\"%s\"}", s->id, esc_title);
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Voice message: append ---- */
    if(!strcmp(path,"/api/voice/message")&&!strcmp(method,"POST")){
        char sid[64]={0}, sender[32]={0}, text[2048]={0}, lang[32]={0};
        get_str(body,"session_id",sid,sizeof sid);
        get_str(body,"sender",sender,sizeof sender);
        get_str(body,"text",text,sizeof text);
        get_str(body,"lang",lang,sizeof lang);
        if(strlen(lang)==0) strcpy(lang,"en-IN");
        if(strlen(sid)==0 || strlen(text)==0){
            send_resp(c,400,"application/json","{\"error\":\"Missing session_id or text\"}");
            return;
        }
        VoiceSession*target_s = NULL;
        for(int i = 0; i < voice_session_count; i++){
            if(!strcmp(voice_sessions[i].id, sid)){
                target_s = &voice_sessions[i];
                break;
            }
        }
        if(!target_s){
            if(voice_session_count >= MAX_VOICE_SESSIONS){
                memmove(&voice_sessions[0], &voice_sessions[1], sizeof(VoiceSession) * (MAX_VOICE_SESSIONS - 1));
                voice_session_count = MAX_VOICE_SESSIONS - 1;
            }
            target_s = &voice_sessions[voice_session_count++];
            strcpy(target_s->id, sid);
            strcpy(target_s->title, "Voice Health Consultation");
            strcpy(target_s->status, "active");
            strcpy(target_s->last_prompt, text);
            get_iso_time(target_s->created_at, sizeof target_s->created_at);
            strcpy(target_s->updated_at, target_s->created_at);
        } else {
            get_iso_time(target_s->updated_at, sizeof target_s->updated_at);
            if(!strcmp(sender, "assistant")){
                strncpy(target_s->last_prompt, text, sizeof(target_s->last_prompt)-1);
            }
        }
        if(voice_message_count >= MAX_VOICE_MESSAGES){
            memmove(&voice_messages[0], &voice_messages[1], sizeof(VoiceMessage) * (MAX_VOICE_MESSAGES - 1));
            voice_message_count = MAX_VOICE_MESSAGES - 1;
        }
        VoiceMessage*m = &voice_messages[voice_message_count++];
        m->id = voice_message_count;
        strcpy(m->session_id, sid);
        strcpy(m->sender, sender);
        strncpy(m->text, text, sizeof(m->text)-1);
        strcpy(m->lang, lang);
        get_iso_time(m->created_at, sizeof m->created_at);

        send_resp(c,200,"application/json","{\"ok\":true}");
        return;
    }

    /* ---- Voice session: clear / complete ---- */
    if(!strcmp(path,"/api/voice/session/clear")&&!strcmp(method,"POST")){
        char sid[64]={0};
        get_str(body,"session_id",sid,sizeof sid);
        for(int i = 0; i < voice_session_count; i++){
            if(strlen(sid) > 0){
                if(!strcmp(voice_sessions[i].id, sid)){
                    strcpy(voice_sessions[i].status, "completed");
                    get_iso_time(voice_sessions[i].updated_at, sizeof voice_sessions[i].updated_at);
                }
            } else {
                if(!strcmp(voice_sessions[i].status, "active")){
                    strcpy(voice_sessions[i].status, "completed");
                    get_iso_time(voice_sessions[i].updated_at, sizeof voice_sessions[i].updated_at);
                }
            }
        }
        send_resp(c,200,"application/json","{\"ok\":true}");
        return;
    }

    send_resp(c,404,"application/json","{\"error\":\"Unknown API route\"}");
}

int main(void){
#ifdef _WIN32
    WSADATA w; if(WSAStartup(MAKEWORD(2,2),&w)!=0)return 1;
#endif
    seed_medicines();           /* reference catalogue only - NO demo patients */
    sock_t s=socket(AF_INET,SOCK_STREAM,0);
    if(s==INVALID_SOCKET){perror("socket");return 1;}
    int one=1;
    setsockopt(s,SOL_SOCKET,SO_REUSEADDR,&one,sizeof(one));
    struct sockaddr_in a;memset(&a,0,sizeof a);
    a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_ANY);a.sin_port=htons(PORT);
    if(bind(s,(struct sockaddr*)&a,sizeof a)==SOCKET_ERROR){perror("bind");return 1;}
    listen(s,16);
    printf("GramCare server: http://localhost:%d\n",PORT);
    printf("No demo patients - ready for new user\n");
    printf("Press Ctrl+C to stop.\n");
    for(;;){
        sock_t c=accept(s,NULL,NULL);
        if(c==INVALID_SOCKET)continue;
        char*b=calloc(1,BUF);
        int n=recv(c,b,BUF-1,0);
        if(n<=0){free(b);CLOSESOCK(c);continue;}
        char method[8]={0},path[256]={0};
        sscanf(b,"%7s %255s",method,path);
        char*body=strstr(b,"\r\n\r\n");body=body?body+4:b+n;
        if(!strncmp(path,"/api/",5))api(c,method,path,body);
        else serve(c,path);
        free(b);CLOSESOCK(c);}
    return 0;
}
