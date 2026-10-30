/* GramCare AI - portable C HTTP server, in-memory storage (educational prototype) */
#ifdef _WIN32
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib,"ws2_32.lib")
typedef SOCKET sock_t;
#define CLOSESOCK closesocket
#define popen _popen
#define pclose _pclose
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
#define MAX_TRANSCRIPTS 200

typedef struct { char id[20], name[80], village[80], mobile[20], flag[16]; int age; } Patient;
static Patient patients[MAX_PATIENTS]; static int patient_count=0;

typedef struct { int id; int hr, spo2; double temp; char flag[16], message[300], issues[300]; } Vitals;
static Vitals vitals[MAX_VITALS]; static int vitals_count=0;

typedef struct { char id[32], name[80], problem[120], status[16], responder[80]; int eta_min; } Alert;
static Alert alerts[MAX_ALERTS]; static int alert_count=0;

typedef struct { char name[80], category[60]; int price; int rx; } Medicine;
static Medicine medicines[MAX_MEDICINES]; static int medicine_count=0;

typedef struct { int id; char transcript[1024]; char language[32]; char created_at[32]; } VoiceTranscript;
static VoiceTranscript voice_transcripts[MAX_TRANSCRIPTS]; static int voice_transcript_count=0;

static void seed_medicines(void){
    Medicine m[]={
        {"Paracetamol 500 mg","Fever & pain",24,0},
        {"ORS Sachet","Hydration",22,0},
        {"Digital Thermometer","Devices",180,0},
        {"Pulse Oximeter","Devices",899,0},
        {"Amoxicillin","Prescription only",120,1}};
    memcpy(medicines,m,sizeof(m)); medicine_count=5;
}

/* ---- HTTP parsing & Sarvam config helpers ---- */
static long get_content_len(const char* b) {
    const char* p = strstr(b, "Content-Length:");
    if (!p) p = strstr(b, "content-length:");
    if (!p) return 0;
    return atol(p + 15);
}
static void get_header_str(const char* headers, const char* name, char* out, size_t max_len) {
    out[0] = 0;
    char pat[80];
    snprintf(pat, sizeof pat, "\n%s:", name);
    const char* p = strstr(headers, pat);
    if (!p) {
        snprintf(pat, sizeof pat, "\r\n%s:", name);
        p = strstr(headers, pat);
    }
    if (!p) return;
    p = strchr(p, ':');
    if (!p) return;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    const char* e = strstr(p, "\r\n");
    if (!e) e = strchr(p, '\n');
    if (!e) e = p + strlen(p);
    size_t len = (size_t)(e - p);
    if (len >= max_len) len = max_len - 1;
    memcpy(out, p, len);
    out[len] = 0;
    while (len > 0 && (out[len - 1] == ' ' || out[len - 1] == '\r')) {
        out[--len] = 0;
    }
}
static void get_query_param(const char* url, const char* param, char* out, size_t max_len, const char* def) {
    strncpy(out, def, max_len - 1);
    out[max_len - 1] = 0;
    char pat[80];
    snprintf(pat, sizeof pat, "%s=", param);
    const char* q = strchr(url, '?');
    if (!q) return;
    const char* p = strstr(q, pat);
    if (!p) return;
    p += strlen(pat);
    const char* e = strpbrk(p, " &\r\n");
    size_t len = e ? (size_t)(e - p) : strlen(p);
    if (len >= max_len) len = max_len - 1;
    memcpy(out, p, len);
    out[len] = 0;
}
static void get_sarvam_key(const char* headers, char* key_out, size_t max_len) {
    key_out[0] = 0;
    if (headers) {
        get_header_str(headers, "X-Sarvam-Key", key_out, max_len);
        if (key_out[0] != 0) return;
    }
    const char* env_k = getenv("SARVAM_API_KEY");
    if (env_k && strlen(env_k) > 0) {
        strncpy(key_out, env_k, max_len - 1);
        key_out[max_len - 1] = 0;
        return;
    }
    FILE* f = fopen(".env", "r");
    if (!f) return;
    char line[256];
    while (fgets(line, sizeof line, f)) {
        char* p = line;
        while (*p == ' ' || *p == '\t') p++;
        if (!strncmp(p, "SARVAM_API_KEY=", 15)) {
            char* val = p + 15;
            while (*val == ' ' || *val == '\"' || *val == '\'') val++;
            size_t len = strlen(val);
            while (len > 0 && (val[len - 1] == '\r' || val[len - 1] == '\n' || val[len - 1] == ' ' || val[len - 1] == '\"' || val[len - 1] == '\'')) {
                val[--len] = 0;
            }
            strncpy(key_out, val, max_len - 1);
            key_out[max_len - 1] = 0;
            break;
        }
    }
    fclose(f);
}
static void extract_json_str(const char* json, const char* key, char* out, size_t max_len) {
    out[0] = 0;
    char pat[80];
    snprintf(pat, sizeof pat, "\"%s\"", key);
    const char* p = strstr(json, pat);
    if (!p) return;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t' || *p == ':') p++;
    if (*p != '\"') return;
    p++;
    size_t idx = 0;
    while (*p && idx + 1 < max_len) {
        if (*p == '\\' && *(p + 1)) {
            p++;
            if (*p == '\"') out[idx++] = '\"';
            else if (*p == 'n') out[idx++] = ' ';
            else if (*p == 't') out[idx++] = ' ';
            else if (*p == '\\') out[idx++] = '\\';
            else out[idx++] = *p;
            p++;
            continue;
        }
        if (*p == '\"') break;
        out[idx++] = *p++;
    }
    out[idx] = 0;
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

/* ---- API handlers ---- */
static void api(sock_t c, const char* method, const char* path, const char* body, long body_len, const char* raw_req){
    char out[BUF];

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

    /* ---- Sarvam AI Speech-to-Text Transcription ---- */
    if (!strncmp(path, "/api/transcribe", 15) && !strcmp(method, "POST")) {
        char key[128] = {0};
        get_sarvam_key(raw_req, key, sizeof key);
        if (strlen(key) == 0) {
            send_resp(c, 400, "application/json",
                "{\"error\":\"SARVAM_API_KEY is not configured. Please add SARVAM_API_KEY in .env file.\"}");
            return;
        }
        if (body_len <= 0) {
            send_resp(c, 400, "application/json", "{\"error\":\"No audio data received\"}");
            return;
        }

        char lang[32] = {0};
        get_query_param(path, "lang", lang, sizeof lang, "hi-IN");

        char tmp_file[64];
        snprintf(tmp_file, sizeof tmp_file, "sarvam_tmp_%ld_%d.webm", (long)time(NULL), rand() % 1000);
        FILE* af = fopen(tmp_file, "wb");
        if (!af) {
            send_resp(c, 500, "application/json", "{\"error\":\"Failed to save temporary audio file\"}");
            return;
        }
        fwrite(body, 1, (size_t)body_len, af);
        fclose(af);

        char cmd[1024];
        snprintf(cmd, sizeof cmd,
            "curl -s -X POST \"https://api.sarvam.ai/speech-to-text\" "
            "-H \"api-subscription-key: %s\" "
            "-F \"file=@%s;type=audio/webm\" "
            "-F \"model=saaras:v4\" "
            "-F \"mode=transcribe\" "
            "-F \"language_code=%s\"",
            key, tmp_file, lang);

        FILE* p = popen(cmd, "r");
        if (!p) {
            remove(tmp_file);
            send_resp(c, 500, "application/json", "{\"error\":\"Failed to execute curl\"}");
            return;
        }

        char* resp = malloc(65536);
        if (!resp) {
            pclose(p);
            remove(tmp_file);
            send_resp(c, 500, "application/json", "{\"error\":\"Out of memory\"}");
            return;
        }

        size_t nread = fread(resp, 1, 65535, p);
        resp[nread] = 0;
        pclose(p);
        remove(tmp_file);

        if (nread == 0) {
            free(resp);
            send_resp(c, 502, "application/json", "{\"error\":\"Empty response from Sarvam AI API\"}");
            return;
        }

        /* Extract transcript text and save to in-memory store */
        char transcript_text[1024] = {0};
        extract_json_str(resp, "transcript", transcript_text, sizeof transcript_text);

        int transcript_id = 0;
        if (strlen(transcript_text) > 0 && voice_transcript_count < MAX_TRANSCRIPTS) {
            VoiceTranscript* vt = &voice_transcripts[voice_transcript_count++];
            vt->id = voice_transcript_count;
            strncpy(vt->transcript, transcript_text, sizeof(vt->transcript) - 1);
            strncpy(vt->language, lang, sizeof(vt->language) - 1);
            time_t now = time(NULL);
            strftime(vt->created_at, sizeof(vt->created_at), "%Y-%m-%d %H:%M:%S", localtime(&now));
            transcript_id = vt->id;
        }

        if (resp[0] == '{') {
            char* final_resp = malloc(65536);
            if (final_resp) {
                snprintf(final_resp, 65536, "{\"db_id\":%d,\"saved_to_db\":%s,%s",
                    transcript_id, transcript_id > 0 ? "true" : "false", resp + 1);
                send_resp(c, 200, "application/json", final_resp);
                free(final_resp);
            } else {
                send_resp(c, 200, "application/json", resp);
            }
        } else {
            send_resp(c, 200, "application/json", resp);
        }
        free(resp);
        return;
    }

    /* ---- Voice Transcripts: list ---- */
    if (!strcmp(path, "/api/transcripts") && !strcmp(method, "GET")) {
        size_t o = 0;
        o += snprintf(out + o, sizeof(out) - o, "[");
        for (int i = voice_transcript_count - 1; i >= 0 && i >= voice_transcript_count - 25; i--) {
            VoiceTranscript* vt = &voice_transcripts[i];
            if (i < voice_transcript_count - 1) o += snprintf(out + o, sizeof(out) - o, ",");
            o += snprintf(out + o, sizeof(out) - o,
                "{\"id\":%d,\"transcript\":\"%s\",\"language\":\"%s\",\"created_at\":\"%s\"}",
                vt->id, vt->transcript, vt->language, vt->created_at);
        }
        snprintf(out + o, sizeof(out) - o, "]");
        send_resp(c, 200, "application/json", out);
        return;
    }

    /* ---- Voice Transcripts: save manually ---- */
    if (!strcmp(path, "/api/transcripts") && !strcmp(method, "POST")) {
        char text[1024] = {0}, lang[32] = {0};
        get_str(body, "transcript", text, sizeof text);
        get_str(body, "language", lang, sizeof lang);
        if (lang[0] == 0) strcpy(lang, "hi-IN");
        if (strlen(text) == 0) {
            send_resp(c, 400, "application/json", "{\"error\":\"Missing transcript text\"}");
            return;
        }
        int tid = 0;
        if (voice_transcript_count < MAX_TRANSCRIPTS) {
            VoiceTranscript* vt = &voice_transcripts[voice_transcript_count++];
            vt->id = voice_transcript_count;
            strncpy(vt->transcript, text, sizeof(vt->transcript) - 1);
            strncpy(vt->language, lang, sizeof(vt->language) - 1);
            time_t now = time(NULL);
            strftime(vt->created_at, sizeof(vt->created_at), "%Y-%m-%d %H:%M:%S", localtime(&now));
            tid = vt->id;
        }
        snprintf(out, sizeof out, "{\"ok\":true,\"id\":%d,\"saved\":true}", tid);
        send_resp(c, 200, "application/json", out);
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
        char* b=calloc(1,BUF);
        int n=recv(c,b,BUF-1,0);
        if(n<=0){free(b);CLOSESOCK(c);continue;}

        char* header_end = strstr(b, "\r\n\r\n");
        long clen = get_content_len(b);
        long header_len = header_end ? (long)(header_end + 4 - b) : n;
        long body_in_b = n - header_len;

        if (clen > body_in_b && clen < 15 * 1024 * 1024) {
            char* full_req = malloc(header_len + clen + 1);
            if (full_req) {
                memcpy(full_req, b, n);
                free(b);
                b = full_req;
                long total_body = body_in_b;
                while (total_body < clen) {
                    int r = recv(c, b + header_len + total_body, (int)(clen - total_body), 0);
                    if (r <= 0) break;
                    total_body += r;
                }
                b[header_len + total_body] = 0;
                n = (int)(header_len + total_body);
                header_end = strstr(b, "\r\n\r\n");
            }
        }

        char method[8]={0},path[256]={0};
        sscanf(b,"%7s %255s",method,path);
        char* body = header_end ? (b + header_len) : (b + n);
        long body_len = clen > 0 ? clen : (long)(n - header_len);
        if (body_len < 0) body_len = 0;

        if(!strncmp(path,"/api/",5))api(c,method,path,body,body_len,b);
        else serve(c,path);
        free(b);CLOSESOCK(c);}
    return 0;
}
