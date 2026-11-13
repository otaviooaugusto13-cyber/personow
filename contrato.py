import re, glob, os, json
R="/home/claude/personow-main"
srv=open(f"{R}/server/server.js",encoding="utf-8").read()
montadas=[m for m in re.findall(r'"([a-z0-9]+)"', re.search(r'for \(const rota of \[([^\]]+)\]',srv).group(1)) if m!="teste"]
rotas=[]
for r in montadas+[]:
    s=open(f"{R}/server/rotas/{r}.js",encoding="utf-8").read()
    for m in re.finditer(r'app\.(get|post|put|delete)\(\s*["\'`]([^"\'`]+)["\'`]',s): rotas.append((m.group(1).upper(),m.group(2),r))
rotas+= [("GET","/saude","server")]
# rotas definidas no próprio server.js (webhook etc.)
for m in re.finditer(r'app\.(get|post|put|delete)\(\s*["\'`]([^"\'`]+)["\'`]',srv): rotas.append((m.group(1).upper(),m.group(2),"server"))
pats=[(m,re.compile("^"+re.sub(r":[A-Za-z]+","[^/]+",p)+"$"),p,a) for m,p,a in rotas]
chamadas=[]
for f in sorted(glob.glob(f"{R}/*.js")+glob.glob(f"{R}/*.html")):
    if f.endswith(("sw.js",)): continue
    t=open(f,encoding="utf-8",errors="ignore").read()
    for m in re.finditer(r'(chamarFuncao|consultar|baixarCSVProtegido|baixarBlobProtegido)\(\s*[`"\']([^`"\']+)[`"\']([^)]*)\)',t):
        fn,p,rest=m.groups()
        p=re.sub(r"\$\{[^}]+\}","X",p).split("?")[0].lstrip("/")
        meth="GET" if (fn in("consultar","baixarCSVProtegido","baixarBlobProtegido") or re.match(r"\s*,\s*null\b",rest)) else "POST"
        mm=re.search(r'["\'](PUT|DELETE|GET|POST)["\']\s*$',rest.strip())
        if mm: meth=mm.group(1)
        chamadas.append((os.path.basename(f),fn,meth,"/"+p))
sem=collections.OrderedDict() if False else {}
for arq,fn,meth,p in chamadas:
    achou=any(mm==meth and rx.match(p) for mm,rx,_,_ in pats)
    achou_outro=[mm for mm,rx,_,_ in pats if rx.match(p) and mm!=meth]
    if not achou: sem.setdefault((meth,p),[]).append(arq)
print("chamadas do front analisadas:",len(chamadas),"| endpoints únicos:",len({(m,p) for _,_,m,p in chamadas}))
print("\nENDPOINTS CHAMADOS PELO FRONT SEM ROTA NO SERVIDOR:")
for (m,p),a in sorted(sem.items()): print(f"  {m:5} {p:45} ← {', '.join(sorted(set(a)))}")
