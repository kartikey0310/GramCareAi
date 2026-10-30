/* GramCare AI - portable C HTTP server with SQLite backend (educational prototype) */
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
#include <sqlite3.h>

#define PORT 8080
#define BUF 65536

static sqlite3 *db;

/* ---- JSON request helpers (unchanged) ---- */
static int get_num(const char*b,const char*k,int def){char pat[80],*p;snprintf(pat,sizeof pat,"\"%s\":",k);p=strstr(b,pat);return p?atoi(p+strlen(pat)):def;}
static double get_double(const char*b,const char*k,double def){char pat[80],*p;snprintf(pat,sizeof pat,"\"%s\":",k);p=strstr(b,pat);return p?atof(p+strlen(pat)):def;}
static void get_str(const char*b,const char*k,char*out,size_t n){char pat[80],*p,*e;out[0]=0;snprintf(pat,sizeof pat,"\"%s\":\"",k);p=strstr(b,pat);if(!p)return;p+=strlen(pat);e=strchr(p,'\"');if(!e)return;size_t z=(size_t)(e-p);if(z>=n)z=n-1;memcpy(out,p,z);out[z]=0;}

/* ---- vitals flag logic (unchanged) ---- */
static const char* edge(double hr,double sp,double tp){
    if(hr<30||hr>220||sp<50||sp>100||tp<30||tp>45)return "INVALID";
    if(sp<90||hr>130||hr<45||tp>=39.5)return "URGENT";
    if(sp<94||hr>100||hr<55||tp>=38)return "REVIEW";
    return "NORMAL";
}

/* ---- MIME ---- */
static const char* mime(const char*p){const char*e=strrchr(p,'.');if(!e)return "text/plain";if(!strcmp(e,".html"))return "text/html; charset=utf-8";if(!strcmp(e,".css"))return "text/css";if(!strcmp(e,".js"))return "application/javascript";if(!strcmp(e,".json"))return "application/json";if(!strcmp(e,".svg"))return "image/svg+xml";return "application/octet-stream";}

/* ---- send helpers ---- */
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

/* ---- DB init: open/create gramcare.db, create tables, NO demo patients ---- */
static void db_init(void){
    if(sqlite3_open("gramcare.db",&db)!=SQLITE_OK){
        fprintf(stderr,"Cannot open database: %s\n",sqlite3_errmsg(db));
        exit(1);
    }
    const char*schema=
        "CREATE TABLE IF NOT EXISTS patients ("
        "id          TEXT    PRIMARY KEY,"
        "name        TEXT    NOT NULL,"
        "age         INTEGER NOT NULL,"
        "village     TEXT    NOT NULL,"
        "mobile      TEXT    NOT NULL,"
        "flag        TEXT    NOT NULL DEFAULT 'NO READINGS',"
        "created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP);"
        "CREATE TABLE IF NOT EXISTS vitals_checks ("
        "id          INTEGER PRIMARY KEY AUTOINCREMENT,"
        "hr          INTEGER NOT NULL,"
        "spo2        INTEGER NOT NULL,"
        "temp        REAL    NOT NULL,"
        "flag        TEXT    NOT NULL,"
        "message     TEXT    NOT NULL,"
        "checked_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP);"
        "CREATE TABLE IF NOT EXISTS medicines ("
        "id        INTEGER PRIMARY KEY AUTOINCREMENT,"
        "name      TEXT    NOT NULL,"
        "category  TEXT    NOT NULL,"
        "price     INTEGER NOT NULL,"
        "rx        INTEGER NOT NULL DEFAULT 0);"
        "CREATE TABLE IF NOT EXISTS emergency_alerts ("
        "id         TEXT     PRIMARY KEY,"
        "name       TEXT     NOT NULL,"
        "problem    TEXT     NOT NULL,"
        "status     TEXT     NOT NULL DEFAULT 'SENT',"
        "responder  TEXT,"
        "eta_min    INTEGER,"
        "created_at TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP);"
        "CREATE INDEX IF NOT EXISTS idx_patients_name   ON patients(name);"
        "CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile);"
        "CREATE INDEX IF NOT EXISTS idx_vitals_checked  ON vitals_checks(checked_at);"
        "CREATE INDEX IF NOT EXISTS idx_alerts_created  ON emergency_alerts(created_at);";
    char*err=0;
    if(sqlite3_exec(db,schema,0,0,&err)!=SQLITE_OK){
        fprintf(stderr,"Schema error: %s\n",err);sqlite3_free(err);exit(1);
    }
    /* Seed medicines only (reference catalogue, not patient/customer data) */
    const char*seed_meds=
        "INSERT OR IGNORE INTO medicines(name,category,price,rx) VALUES "
        "('Paracetamol 500 mg','Fever & pain',24,0),"
        "('ORS Sachet','Hydration',22,0),"
        "('Digital Thermometer','Devices',180,0),"
        "('Pulse Oximeter','Devices',899,0),"
        "('Amoxicillin','Prescription only',120,1);";
    if(sqlite3_exec(db,seed_meds,0,0,&err)!=SQLITE_OK){
        fprintf(stderr,"Seed medicines error: %s\n",err);sqlite3_free(err);
    }
}

/* ---- API handlers with SQLite persistence ---- */
static void api(sock_t c,const char*method,const char*path,const char*body){
    char out[BUF];

    if(!strcmp(path,"/api/health")){
        send_resp(c,200,"application/json","{\"ok\":true,\"backend\":\"C + SQLite\",\"name\":\"GramCare AI\"}");
        return;
    }

    /* ---- Vitals ---- */
    if(!strcmp(path,"/api/vitals")&&!strcmp(method,"POST")){
        double hr=get_double(body,"hr",0),sp=get_double(body,"spo2",0),tp=get_double(body,"temp",0);
        const char*f=edge(hr,sp,tp);
        const char*msg=!strcmp(f,"INVALID")?"Re-check the measurement":"Attention flag only - not a diagnosis";
        sqlite3_stmt*st;
        sqlite3_prepare_v2(db,"INSERT INTO vitals_checks(hr,spo2,temp,flag,message) VALUES(?,?,?,?,?)",-1,&st,0);
        sqlite3_bind_int(st,1,(int)hr);
        sqlite3_bind_int(st,2,(int)sp);
        sqlite3_bind_double(st,3,tp);
        sqlite3_bind_text(st,4,f,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,5,msg,-1,SQLITE_TRANSIENT);
        sqlite3_step(st);sqlite3_finalize(st);
        snprintf(out,sizeof out,"{\"flag\":\"%s\",\"message\":\"%s\"}",f,msg);
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Patients: list ---- */
    if(!strcmp(path,"/api/patients")&&!strcmp(method,"GET")){
        size_t o=0;o+=snprintf(out+o,sizeof(out)-o,"[");
        sqlite3_stmt*st;
        sqlite3_prepare_v2(db,"SELECT id,name,age,village,mobile,flag FROM patients ORDER BY created_at DESC",-1,&st,0);
        int first=1;
        while(sqlite3_step(st)==SQLITE_ROW){
            if(!first)o+=snprintf(out+o,sizeof(out)-o,",");first=0;
            const char*pid_str=(const char*)sqlite3_column_text(st,0);
            const char*name=(const char*)sqlite3_column_text(st,1);
            int age=sqlite3_column_int(st,2);
            const char*village=(const char*)sqlite3_column_text(st,3);
            const char*mobile=(const char*)sqlite3_column_text(st,4);
            const char*flag=(const char*)sqlite3_column_text(st,5);
            o+=snprintf(out+o,sizeof(out)-o,
                "{\"id\":\"%s\",\"name\":\"%s\",\"age\":%d,\"village\":\"%s\",\"mobile\":\"%s\",\"flag\":\"%s\"}",
                pid_str?pid_str:"",name?name:"",age,village?village:"",mobile?mobile:"",flag?flag:"");
        }
        sqlite3_finalize(st);
        snprintf(out+o,sizeof(out)-o,"]");
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Patients: create ---- */
    if(!strcmp(path,"/api/patients")&&!strcmp(method,"POST")){
        char name[80]={0},village[80]={0},mobile[20]={0};
        int age=get_num(body,"age",-1);
        get_str(body,"name",name,sizeof name);
        get_str(body,"village",village,sizeof village);
        get_str(body,"mobile",mobile,sizeof mobile);
        if(strlen(name)<2||age<0||age>120||strlen(village)<2||strlen(mobile)!=10){
            send_resp(c,400,"application/json","{\"error\":\"Invalid patient details\"}");
            return;
        }
        sqlite3_stmt*st;
        sqlite3_prepare_v2(db,"SELECT COUNT(*) FROM patients",-1,&st,0);
        sqlite3_step(st);
        int count=sqlite3_column_int(st,0);sqlite3_finalize(st);
        char pid[20];snprintf(pid,sizeof pid,"GC-%d",1001+count);
        const char*flag="NO READINGS";
        sqlite3_prepare_v2(db,
            "INSERT INTO patients(id,name,age,village,mobile,flag) VALUES(?,?,?,?,?,?)",-1,&st,0);
        sqlite3_bind_text(st,1,pid,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,2,name,-1,SQLITE_TRANSIENT);
        sqlite3_bind_int(st,3,age);
        sqlite3_bind_text(st,4,village,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,5,mobile,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,6,flag,-1,SQLITE_TRANSIENT);
        if(sqlite3_step(st)!=SQLITE_DONE){sqlite3_finalize(st);send_resp(c,400,"application/json","{\"error\":\"Could not save patient\"}");return;}
        sqlite3_finalize(st);
        snprintf(out,sizeof out,"{\"ok\":true,\"id\":\"%s\"}",pid);
        send_resp(c,200,"application/json",out);
        return;
    }

    /* ---- Medicines: list ---- */
    if(!strcmp(path,"/api/medicines")){
        size_t o=0;o+=snprintf(out+o,sizeof(out)-o,"[");
        sqlite3_stmt*st;
        sqlite3_prepare_v2(db,"SELECT name,category,price,rx FROM medicines ORDER BY id",-1,&st,0);
        int first=1;
        while(sqlite3_step(st)==SQLITE_ROW){
            if(!first)o+=snprintf(out+o,sizeof(out)-o,",");first=0;
            const char*name=(const char*)sqlite3_column_text(st,0);
            const char*cat=(const char*)sqlite3_column_text(st,1);
            int price=sqlite3_column_int(st,2);
            int rx=sqlite3_column_int(st,3);
            o+=snprintf(out+o,sizeof(out)-o,
                "{\"name\":\"%s\",\"category\":\"%s\",\"price\":%d,\"rx\":%s}",
                name?name:"",cat?cat:"",price,rx?"true":"false");
        }
        sqlite3_finalize(st);
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
        char alert_id[32];snprintf(alert_id,sizeof alert_id,"SOS-%ld",(long)time(NULL));
        sqlite3_stmt*st;
        sqlite3_prepare_v2(db,
            "INSERT INTO emergency_alerts(id,name,problem,responder,eta_min) VALUES(?,?,?,?,?)",-1,&st,0);
        sqlite3_bind_text(st,1,alert_id,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,2,name,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,3,problem,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(st,4,"Nearest on-duty doctor / ASHA",-1,SQLITE_TRANSIENT);
        sqlite3_bind_int(st,5,8);
        sqlite3_step(st);sqlite3_finalize(st);
        snprintf(out,sizeof out,
            "{\"id\":\"%s\",\"status\":\"SENT\",\"patient\":\"%s\",\"problem\":\"%s\","
            "\"responder\":\"Nearest on-duty doctor / ASHA\",\"eta_min\":8}",
            alert_id,name,problem);
        send_resp(c,200,"application/json",out);
        return;
    }

    send_resp(c,404,"application/json","{\"error\":\"Unknown API route\"}");
}

/* ---- main ---- */
int main(void){
#ifdef _WIN32
    WSADATA w; if(WSAStartup(MAKEWORD(2,2),&w)!=0)return 1;
#endif
    db_init();                      /* opens gramcare.db, creates tables, no seed patients */
    sock_t s=socket(AF_INET,SOCK_STREAM,0);
    if(s==INVALID_SOCKET){perror("socket");return 1;}
    int one=1;
    setsockopt(s,SOL_SOCKET,SO_REUSEADDR,&one,sizeof(one));
#ifdef SO_REUSEPORT
    setsockopt(s,SOL_SOCKET,SO_REUSEPORT,&one,sizeof(one));
#endif
    struct sockaddr_in a;memset(&a,0,sizeof a);
    a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_ANY);a.sin_port=htons(PORT);
    if(bind(s,(struct sockaddr*)&a,sizeof a)==SOCKET_ERROR){perror("bind");return 1;}
    listen(s,16);
    printf("GramCare C + SQLite server: http://localhost:%d\n",PORT);
    printf("Database: gramcare.db  (no demo patients - ready for new user)\n");
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
        free(b);CLOSESOCK(c);
    }
    sqlite3_close(db);
    return 0;
}
