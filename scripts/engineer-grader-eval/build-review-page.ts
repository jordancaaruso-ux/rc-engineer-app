/**
 * Turns a read-only answer run into a single self-contained review page.
 *
 *   npx tsx scripts/engineer-grader-eval/build-review-page.ts --label=pilot
 *
 * Output: scripts/engineer-grader-eval/results/review-<label>.html
 * Publish that file with the Artifact tool. No external assets — CSP-safe.
 *
 * Flags + notes persist in localStorage per answer id, and "Copy notes" puts a
 * markdown digest on the clipboard to paste straight back into chat.
 */
import fs from "node:fs/promises";
import path from "node:path";

const RESULTS_DIR = path.join(process.cwd(), "scripts/engineer-grader-eval/results");

function arg(argv: string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const CSS = `
:root{
  --ground:#F6F8F9; --surface:#FFFFFF; --raised:#EDF2F3;
  --ink:#0F181C; --muted:#5B6B72; --line:#DCE4E7;
  --accent:#0E7C7B; --accent-soft:#D7ECEB;
  --clean:#3B7F55; --watch:#A8761A; --flaw:#B8433A;
  --shadow:0 1px 2px rgba(15,24,28,.06),0 8px 24px rgba(15,24,28,.05);
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#0C1214; --surface:#141D21; --raised:#1B262B;
    --ink:#E4EDEF; --muted:#8FA0A7; --line:#26343A;
    --accent:#45C9C0; --accent-soft:#12332F;
    --clean:#63B586; --watch:#D8A64A; --flaw:#E4746A;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
  }
}
:root[data-theme="light"]{
  --ground:#F6F8F9; --surface:#FFFFFF; --raised:#EDF2F3;
  --ink:#0F181C; --muted:#5B6B72; --line:#DCE4E7;
  --accent:#0E7C7B; --accent-soft:#D7ECEB;
  --clean:#3B7F55; --watch:#A8761A; --flaw:#B8433A;
  --shadow:0 1px 2px rgba(15,24,28,.06),0 8px 24px rgba(15,24,28,.05);
}
:root[data-theme="dark"]{
  --ground:#0C1214; --surface:#141D21; --raised:#1B262B;
  --ink:#E4EDEF; --muted:#8FA0A7; --line:#26343A;
  --accent:#45C9C0; --accent-soft:#12332F;
  --clean:#63B586; --watch:#D8A64A; --flaw:#E4746A;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:15px; line-height:1.5;
}
.mono{font-family:ui-monospace,SFMono-Regular,"Cascadia Mono",Consolas,monospace;font-variant-numeric:tabular-nums}

header{
  padding:18px 24px; border-bottom:1px solid var(--line); background:var(--surface);
  display:flex; flex-wrap:wrap; gap:18px 28px; align-items:baseline;
}
h1{font-size:17px; margin:0; letter-spacing:-.01em; font-weight:650}
.sub{color:var(--muted); font-size:13px}
.stats{margin-left:auto; display:flex; gap:22px; flex-wrap:wrap}
.stat{display:flex; flex-direction:column; gap:1px}
.stat b{font-size:16px; font-weight:650}
.stat span{font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--muted)}

.bar{
  padding:10px 24px; border-bottom:1px solid var(--line); background:var(--ground);
  display:flex; gap:8px; flex-wrap:wrap; align-items:center;
}
.chip{
  border:1px solid var(--line); background:var(--surface); color:var(--muted);
  border-radius:999px; padding:4px 11px; font-size:12px; cursor:pointer;
  font-family:inherit;
}
.chip:hover{border-color:var(--accent); color:var(--ink)}
.chip[aria-pressed="true"]{background:var(--accent-soft); border-color:var(--accent); color:var(--ink); font-weight:600}
.chip:focus-visible,button:focus-visible,li:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.spacer{margin-left:auto}
.btn{
  border:1px solid var(--line); background:var(--surface); color:var(--ink);
  border-radius:7px; padding:5px 12px; font-size:12.5px; cursor:pointer; font-family:inherit;
}
.btn:hover{border-color:var(--accent)}

main{display:grid; grid-template-columns:minmax(280px,340px) 1fr; min-height:calc(100vh - 118px)}
@media(max-width:880px){main{grid-template-columns:1fr}}

ol.list{list-style:none; margin:0; padding:0; border-right:1px solid var(--line); overflow-y:auto; max-height:calc(100vh - 118px)}
@media(max-width:880px){ol.list{max-height:300px}}
ol.list li{
  padding:11px 16px 11px 14px; border-bottom:1px solid var(--line); cursor:pointer;
  display:grid; gap:4px; border-left:3px solid transparent;
}
ol.list li:hover{background:var(--raised)}
ol.list li[aria-current="true"]{background:var(--raised); border-left-color:var(--accent)}
li.f-clean{border-left-color:var(--clean)}
li.f-watch{border-left-color:var(--watch)}
li.f-flaw{border-left-color:var(--flaw)}
.li-top{display:flex; gap:8px; align-items:baseline; font-size:11px; color:var(--muted)}
.li-shape{color:var(--accent); font-weight:650; letter-spacing:.02em}
.li-q{font-size:13.5px; line-height:1.35; color:var(--ink)}
.li-meta{font-size:11px; color:var(--muted)}

article{padding:26px 34px; overflow-y:auto; max-height:calc(100vh - 118px)}
@media(max-width:880px){article{max-height:none}}
.axes{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px}
.tag{font-size:11px; padding:3px 9px; border-radius:5px; background:var(--raised); color:var(--muted); border:1px solid var(--line)}
.tag b{color:var(--ink); font-weight:600}

.qbox{
  background:var(--accent-soft); border-left:3px solid var(--accent);
  padding:14px 18px; border-radius:0 8px 8px 0; margin-bottom:22px;
}
.qbox .label{font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); margin-bottom:5px}
.qbox p{margin:0; font-size:16px; line-height:1.45}

.answer{
  font-family:Charter,Georgia,"Iowan Old Style",serif;
  font-size:16.5px; line-height:1.62; max-width:68ch;
}
.answer p{margin:0 0 .85em}
.answer ul,.answer ol{margin:0 0 .9em; padding-left:1.35em}
.answer li{margin:.3em 0}
.answer strong{font-weight:650}
.answer h3{font-family:ui-sans-serif,system-ui,sans-serif; font-size:14px; margin:1.4em 0 .5em; letter-spacing:.01em}
.answer code{font-family:ui-monospace,Consolas,monospace; font-size:.88em; background:var(--raised); padding:1px 5px; border-radius:4px}

.review{margin-top:30px; padding-top:20px; border-top:1px solid var(--line); max-width:68ch}
.review h2{font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); margin:0 0 10px; font-weight:600}
.flags{display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap}
.flag{border:1px solid var(--line); background:var(--surface); border-radius:7px; padding:6px 14px; font-size:13px; cursor:pointer; color:var(--ink); font-family:inherit}
.flag[aria-pressed="true"][data-f="clean"]{background:var(--clean); border-color:var(--clean); color:#fff}
.flag[aria-pressed="true"][data-f="watch"]{background:var(--watch); border-color:var(--watch); color:#fff}
.flag[aria-pressed="true"][data-f="flaw"]{background:var(--flaw); border-color:var(--flaw); color:#fff}
textarea{
  width:100%; min-height:92px; padding:11px 13px; border-radius:8px; resize:vertical;
  border:1px solid var(--line); background:var(--surface); color:var(--ink);
  font-family:inherit; font-size:14px; line-height:1.5;
}
textarea:focus-visible{outline:2px solid var(--accent); outline-offset:1px}
.hint{font-size:12px; color:var(--muted); margin-top:8px}
kbd{font-family:ui-monospace,Consolas,monospace; font-size:11px; background:var(--raised); border:1px solid var(--line); border-radius:4px; padding:1px 5px}
.empty{color:var(--muted); padding:40px; text-align:center}
`;

const SCRIPT = `
const F=["clean","watch","flaw"];
const KEY="rc-eng-review-"+DATA.label;
let store=JSON.parse(localStorage.getItem(KEY)||"{}");
let filter=null, cur=0;
const save=()=>localStorage.setItem(KEY,JSON.stringify(store));
const esc=s=>s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

function md(t){
  const lines=esc(t).split(/\\n/);
  let out="",list=null;
  const inline=s=>s.replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>")
                   .replace(/\`(.+?)\`/g,"<code>$1</code>");
  for(const raw of lines){
    const l=raw.trim();
    if(!l){ if(list){out+="</"+list+">";list=null;} continue; }
    const bullet=l.match(/^[-*•]\\s+(.*)/);
    const num=l.match(/^\\d+[.)]\\s+(.*)/);
    const head=l.match(/^#{1,4}\\s+(.*)/);
    if(head){ if(list){out+="</"+list+">";list=null;} out+="<h3>"+inline(head[1])+"</h3>"; continue; }
    if(bullet){ if(list!=="ul"){ if(list)out+="</"+list+">"; out+="<ul>"; list="ul";} out+="<li>"+inline(bullet[1])+"</li>"; continue; }
    if(num){ if(list!=="ol"){ if(list)out+="</"+list+">"; out+="<ol>"; list="ol";} out+="<li>"+inline(num[1])+"</li>"; continue; }
    if(list){out+="</"+list+">";list=null;}
    out+="<p>"+inline(l)+"</p>";
  }
  if(list)out+="</"+list+">";
  return out;
}

function visible(){ return DATA.rows.filter(r=>!filter||r.axes.questionShape===filter); }

function renderList(){
  const rows=visible();
  const ol=document.getElementById("list");
  if(!rows.length){ ol.innerHTML='<li class="empty">No answers match.</li>'; return; }
  ol.innerHTML=rows.map((r,i)=>{
    const f=store[r.scenarioId]&&store[r.scenarioId].flag;
    const words=r.reply?r.reply.split(/\\s+/).length:0;
    return '<li tabindex="0" data-i="'+i+'" class="'+(f?"f-"+f:"")+'" aria-current="'+(i===cur)+'">'
      +'<div class="li-top"><span class="li-shape">'+esc(r.axes.questionShape||"?")+'</span>'
      +'<span>'+esc(r.axes.archetype||"")+'</span></div>'
      +'<div class="li-q">'+esc((r.question||"").slice(0,105))+'</div>'
      +'<div class="li-meta mono">'+words+'w · '+Math.round(r.latencyMs/1000)+'s'+(r.error?" · ERROR":"")+'</div></li>';
  }).join("");
  [...ol.children].forEach(li=>{
    if(!li.dataset.i)return;
    li.onclick=()=>{cur=+li.dataset.i;render();};
    li.onkeydown=e=>{if(e.key==="Enter"){cur=+li.dataset.i;render();}};
  });
}

function renderDetail(){
  const rows=visible();
  const el=document.getElementById("detail");
  if(!rows.length){el.innerHTML='<div class="empty">Nothing to show.</div>';return;}
  if(cur>=rows.length)cur=0;
  const r=rows[cur];
  const s=store[r.scenarioId]||{};
  const ax=Object.entries(r.axes).filter(([,v])=>v).map(([k,v])=>
    '<span class="tag">'+esc(k.replace(/([A-Z])/g," $1").toLowerCase())+' <b>'+esc(String(v))+'</b></span>').join("");
  el.innerHTML='<div class="axes">'+ax+'</div>'
    +'<div class="qbox"><div class="label">Driver asks</div><p>'+esc(r.question)+'</p></div>'
    +(r.error?'<div class="answer"><p><strong>Error:</strong> '+esc(r.error)+'</p></div>'
             :'<div class="answer">'+md(r.reply||"")+'</div>')
    +'<div class="review"><h2>Your verdict</h2><div class="flags">'
    +F.map(f=>'<button class="flag" data-f="'+f+'" aria-pressed="'+(s.flag===f)+'">'
      +({clean:"Good",watch:"Suspect",flaw:"Flawed"}[f])+'</button>').join("")
    +'</div><textarea id="note" placeholder="What is wrong with this answer? Quote the phrase.">'+esc(s.note||"")+'</textarea>'
    +'<div class="hint"><kbd>j</kbd>/<kbd>k</kbd> next &amp; previous · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> flag · '
    +(r.promptTokens?('<span class="mono">'+r.promptTokens+' in / '+r.completionTokens+' out</span>'):'')+'</div></div>';

  el.querySelectorAll(".flag").forEach(b=>b.onclick=()=>setFlag(b.dataset.f));
  document.getElementById("note").oninput=e=>{
    store[r.scenarioId]=Object.assign({},store[r.scenarioId],{note:e.target.value});save();
  };
}

function setFlag(f){
  const r=visible()[cur]; if(!r)return;
  const s=store[r.scenarioId]||{};
  store[r.scenarioId]=Object.assign({},s,{flag:s.flag===f?null:f});
  save();render();
}

function renderStats(){
  const flagged=Object.values(store).filter(v=>v&&v.flag);
  document.getElementById("st-flaw").textContent=flagged.filter(v=>v.flag==="flaw").length;
  document.getElementById("st-done").textContent=flagged.length+"/"+DATA.rows.length;
}

function render(){renderList();renderDetail();renderStats();}

document.addEventListener("keydown",e=>{
  if(e.target.tagName==="TEXTAREA")return;
  const n=visible().length;
  if(e.key==="j"){cur=Math.min(cur+1,n-1);render();}
  if(e.key==="k"){cur=Math.max(cur-1,0);render();}
  if(["1","2","3"].includes(e.key))setFlag(F[+e.key-1]);
});

document.getElementById("copy").onclick=async()=>{
  const lines=["# Engineer review — "+DATA.label,""];
  for(const r of DATA.rows){
    const s=store[r.scenarioId]; if(!s||(!s.flag&&!s.note))continue;
    lines.push("## "+r.scenarioId+"  ["+(s.flag||"noted")+"]");
    lines.push("**Q:** "+r.question);
    if(s.note)lines.push("**Jordan:** "+s.note);
    lines.push("");
  }
  await navigator.clipboard.writeText(lines.length>2?lines.join("\\n"):"(nothing flagged yet)");
  const b=document.getElementById("copy");b.textContent="Copied";setTimeout(()=>b.textContent="Copy notes",1400);
};

(function(){
  const shapes=[...new Set(DATA.rows.map(r=>r.axes.questionShape).filter(Boolean))].sort();
  const bar=document.getElementById("chips");
  bar.innerHTML=['<button class="chip" data-s="" aria-pressed="true">All '+DATA.rows.length+'</button>']
    .concat(shapes.map(s=>'<button class="chip" data-s="'+s+'" aria-pressed="false">'+s+'</button>')).join("");
  bar.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{
    filter=c.dataset.s||null; cur=0;
    bar.querySelectorAll(".chip").forEach(x=>x.setAttribute("aria-pressed",String(x===c)));
    render();
  });
  render();
})();
`;

async function main() {
  const label = arg(process.argv.slice(2), "label") ?? "pilot";
  const src = path.join(RESULTS_DIR, `readonly-${label}.json`);
  const data = JSON.parse(await fs.readFile(src, "utf8"));

  const words = data.rows
    .filter((r: { reply?: string }) => r.reply)
    .map((r: { reply: string }) => r.reply.split(/\s+/).length);
  const avgWords = words.length ? Math.round(words.reduce((a: number, b: number) => a + b, 0) / words.length) : 0;
  const shapes = new Set(data.rows.map((r: { axes: { questionShape?: string } }) => r.axes.questionShape)).size;

  const html = `<title>Engineer answers — ${label}</title>
<style>${CSS}</style>
<header>
  <div>
    <h1>Engineer answer review</h1>
    <div class="sub">${data.answered} answers · ${data.model} · real account context</div>
  </div>
  <div class="stats">
    <div class="stat"><b>${shapes}</b><span>question shapes</span></div>
    <div class="stat"><b>${avgWords}</b><span>avg words</span></div>
    <div class="stat"><b id="st-flaw">0</b><span>flawed</span></div>
    <div class="stat"><b id="st-done">0/${data.answered}</b><span>reviewed</span></div>
    <div class="stat"><b>$${(data.totalEstCostUsd ?? 0).toFixed(2)}</b><span>run cost</span></div>
  </div>
</header>
<div class="bar">
  <div id="chips" style="display:flex;gap:8px;flex-wrap:wrap"></div>
  <div class="spacer"></div>
  <button class="btn" id="copy">Copy notes</button>
</div>
<main>
  <ol class="list" id="list"></ol>
  <article id="detail"></article>
</main>
<script>const DATA=${JSON.stringify(data)};</script>
<script>${SCRIPT}</script>`;

  const out = path.join(RESULTS_DIR, `review-${label}.html`);
  await fs.writeFile(out, html, "utf8");
  console.log(`Wrote ${out}  (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
