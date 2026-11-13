(function(){
  var KEY="diario-de-bordo:entradas", NAME="diario-de-bordo:nome";
  var DB_NAME="diario-de-bordo", STORE="handles", HKEY="arquivo-json";
  var TYPES=[{description:"Arquivos JSON",accept:{"application/json":[".json"]}}];
  var entries=[];
  var fileHandle=null;        // arquivo JSON conectado no computador
  var needsPermission=false;  // true quando o navegador pede para reautorizar o arquivo
  var fileOk=true;            // false se o arquivo estiver ilegível (evita sobrescrever)
  var editingId=null;         // id do registro que está sendo editado (null = novo registro)
  // File System Access API: Chrome, Edge, Opera. Nos demais, usa importar/baixar.
  var canFS=!!(window.showOpenFilePicker&&window.showSaveFilePicker);

  function load(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function save(k,v){try{localStorage.setItem(k,v)}catch(e){}}

  try{entries=JSON.parse(load(KEY)||"[]");if(!Array.isArray(entries))entries=[]}catch(e){entries=[]}

  var $=function(id){return document.getElementById(id)};
  var nome=$("nome"), titulo=$("titulo"), desc=$("desc"), err=$("err");
  nome.value=load(NAME)||"";
  var fmt=new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});

  /* ---------- Interface de edição (criada aqui, sem mexer no HTML) ---------- */

  var submitBtn=$("f").querySelector('button[type="submit"]');
  var submitLabel=submitBtn.textContent;

  var editBanner=document.createElement("p");
  editBanner.className="editing-banner";
  editBanner.hidden=true;
  editBanner.setAttribute("role","status");
  err.parentNode.insertBefore(editBanner,err);

  var cancelBtn=document.createElement("button");
  cancelBtn.type="button";
  cancelBtn.className="sec";
  cancelBtn.textContent="Cancelar edição";
  cancelBtn.hidden=true;

  var actions=document.createElement("div");
  actions.className="actions";
  submitBtn.parentNode.insertBefore(actions,submitBtn);
  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);

  /* ---------- Utilidades ---------- */

  function stamp(e){return e.editadoEm||e.ts||0}

  // Junta duas listas pelo id, sem descartar nada.
  // Se o mesmo registro existir nas duas, vale a versão mais recente (edição ou criação).
  function mergeById(a,b){
    var map={};
    a.concat(b).forEach(function(e){
      if(!e||!e.id)return;
      var cur=map[e.id];
      if(!cur||stamp(e)>=stamp(cur))map[e.id]=e;
    });
    return Object.keys(map).map(function(k){return map[k]});
  }

  function showFile(){
    $("file-name").textContent=fileHandle?fileHandle.name+(needsPermission?" (precisa reautorizar)":""):"nenhum";
    var b=$("btn-connect");
    if(!canFS)b.textContent="Importar arquivo JSON";
    else if(needsPermission)b.textContent="Reautorizar arquivo";
    else b.textContent=fileHandle?"Trocar arquivo JSON":"Conectar Arquivo JSON";
  }

  function markSync(txt){
    $("file-sync").textContent=txt||new Date().toLocaleString("pt-BR");
  }

  /* ---------- IndexedDB: guarda o arquivo escolhido para o dia seguinte ---------- */

  function openDB(){
    return new Promise(function(res,rej){
      var r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=function(){r.result.createObjectStore(STORE)};
      r.onsuccess=function(){res(r.result)};
      r.onerror=function(){rej(r.error)};
    });
  }
  function idbGet(k){
    return openDB().then(function(db){
      return new Promise(function(res,rej){
        var q=db.transaction(STORE).objectStore(STORE).get(k);
        q.onsuccess=function(){res(q.result)};
        q.onerror=function(){rej(q.error)};
      });
    });
  }
  function idbSet(k,v){
    return openDB().then(function(db){
      return new Promise(function(res,rej){
        var t=db.transaction(STORE,"readwrite");
        t.objectStore(STORE).put(v,k);
        t.oncomplete=function(){res()};
        t.onerror=function(){rej(t.error)};
      });
    });
  }

  /* ---------- Arquivo JSON ---------- */

  async function hasPermission(h,ask){
    var o={mode:"readwrite"};
    if((await h.queryPermission(o))==="granted")return true;
    if(ask&&(await h.requestPermission(o))==="granted")return true;
    return false;
  }

  // Lê o arquivo e MESCLA com a memória (nunca substitui).
  // Retorna true se o arquivo estava desatualizado e precisa ser regravado.
  async function syncFromFile(){
    fileOk=true;
    if(!fileHandle||needsPermission)return false;
    try{
      var file=await fileHandle.getFile();
      var text=await file.text();
      var fromFile=[];
      if(text.trim()){
        fromFile=JSON.parse(text);
        if(!Array.isArray(fromFile))throw new Error("formato inválido");
      }
      var baseline=JSON.stringify(mergeById(fromFile,[]));
      entries=mergeById(fromFile,entries);
      save(KEY,JSON.stringify(entries));
      return JSON.stringify(entries)!==baseline;
    }catch(e){
      fileOk=false;
      markSync("arquivo ilegível: nada foi sobrescrito");
      return false;
    }
  }

  function downloadJson(){
    var blob=new Blob([JSON.stringify(entries,null,2)],{type:"application/json"});
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="diario-de-bordo.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
  }

  // Salva no LocalStorage e grava no arquivo JSON conectado
  async function persistData(){
    save(KEY,JSON.stringify(entries));
    if(!canFS){downloadJson();markSync();return}
    if(!fileHandle||!fileOk)return;
    try{
      if(!(await hasPermission(fileHandle,true))){
        needsPermission=true;showFile();
        markSync("sem permissão: registro salvo só no navegador");
        return;
      }
      needsPermission=false;showFile();
      var writable=await fileHandle.createWritable();
      await writable.write(JSON.stringify(entries,null,2));
      await writable.close();
      markSync();
    }catch(e){
      markSync("falha ao gravar no arquivo");
    }
  }

  async function useHandle(h){
    if(!(await hasPermission(h,true))){
      alert("Sem permissão de escrita, o arquivo não foi conectado.");
      return;
    }
    fileHandle=h;
    needsPermission=false;
    await idbSet(HKEY,h);
    showFile();
    var desatualizado=await syncFromFile();
    if(desatualizado)await persistData();else markSync();
    render();
  }

  // Navegadores sem File System Access API: importa o JSON escolhido
  function importFallback(){
    var inp=document.createElement("input");
    inp.type="file";inp.accept="application/json,.json";
    inp.addEventListener("change",async function(){
      var f=inp.files&&inp.files[0];
      if(!f)return;
      try{
        var data=JSON.parse(await f.text());
        if(!Array.isArray(data))throw new Error("formato inválido");
        entries=mergeById(data,entries);
        save(KEY,JSON.stringify(entries));
        $("file-name").textContent=f.name;
        render();
      }catch(e){
        alert("O arquivo escolhido não é um JSON válido do diário.");
      }
    });
    inp.click();
  }

  /* ---------- Edição ---------- */

  function startEdit(e){
    editingId=e.id;
    titulo.value=e.titulo||"";
    desc.value=e.desc||"";
    editBanner.textContent="Editando o registro de "+e.nome+". O nome informado em \"Seu nome\" será gravado como editor.";
    editBanner.hidden=false;
    cancelBtn.hidden=false;
    submitBtn.textContent="Salvar alterações";
    err.textContent="";
    render();
    $("f").scrollIntoView({block:"start"});
    (nome.value.trim()?titulo:nome).focus();
  }

  function stopEdit(){
    editingId=null;
    titulo.value="";desc.value="";
    err.textContent="";
    editBanner.hidden=true;
    cancelBtn.hidden=true;
    submitBtn.textContent=submitLabel;
    render();
  }

  /* ---------- Lista ---------- */

  function render(){
    var q=$("q").value.trim().toLowerCase(), list=$("list");
    list.textContent="";
    var shown=entries.filter(function(e){
      return !q||((e.titulo||"")+" "+e.nome+" "+(e.editadoPor||"")).toLowerCase().indexOf(q)>-1;
    }).sort(function(a,b){return b.ts-a.ts});
    $("count").textContent=shown.length+(shown.length===1?" registro":" registros");
    if(!shown.length){
      var d=document.createElement("li");d.className="empty";
      d.textContent=entries.length?"Nenhum registro corresponde à busca.":"Nenhum registro ainda. Preencha o formulário para criar o primeiro.";
      list.appendChild(d);return;
    }
    shown.forEach(function(e){
      var li=document.createElement("li");
      if(editingId===e.id)li.className="is-editing";
      var header=document.createElement("div");header.className="card-header";
      var t=document.createElement("p");t.className="ttl";t.textContent=e.titulo||(e.tipo==="ocorrencia"?"Ocorrência":"Atividade");

      var editBtn=document.createElement("button");
      editBtn.type="button";
      editBtn.className="btn-edit";
      editBtn.textContent="✎";
      editBtn.title="Editar registro";
      editBtn.setAttribute("aria-label","Editar registro");
      editBtn.addEventListener("click",function(){startEdit(e)});

      header.appendChild(t);
      header.appendChild(editBtn);

      var m=document.createElement("div");m.className="meta";
      var w=document.createElement("span");w.className="who";w.textContent=e.nome;
      var h=document.createElement("span");h.className="when";h.textContent=fmt.format(new Date(e.ts)).replace(",","");
      m.appendChild(w);m.appendChild(h);
      if(e.editadoPor){
        var ed=document.createElement("span");ed.className="edited";
        ed.textContent="Editado por "+e.editadoPor+" em "+fmt.format(new Date(e.editadoEm||e.ts)).replace(",","");
        m.appendChild(ed);
      }
      var p=document.createElement("p");p.className="txt";p.textContent=e.desc;

      li.appendChild(header);li.appendChild(m);li.appendChild(p);list.appendChild(li);
    });
  }

  /* ---------- Eventos ---------- */

  cancelBtn.addEventListener("click",stopEdit);

  // Conectar a um arquivo JSON existente (ou reautorizar o do dia anterior)
  $("btn-connect").addEventListener("click",async function(){
    if(!canFS){importFallback();return}
    try{
      if(fileHandle&&needsPermission&&(await hasPermission(fileHandle,true))){
        needsPermission=false;showFile();
        var desatualizado=await syncFromFile();
        if(desatualizado)await persistData();else markSync();
        render();
        return;
      }
      var r=await window.showOpenFilePicker({types:TYPES,multiple:false});
      await useHandle(r[0]);
    }catch(e){
      if(!e||e.name!=="AbortError")alert("Não foi possível abrir o arquivo.");
    }
  });

  // Criar o arquivo JSON na primeira vez (precisa do botão #btn-create no HTML)
  var btnCreate=$("btn-create");
  if(btnCreate){
    if(!canFS)btnCreate.hidden=true;
    btnCreate.addEventListener("click",async function(){
      try{
        var h=await window.showSaveFilePicker({suggestedName:"diario-de-bordo.json",types:TYPES});
        await useHandle(h);
      }catch(e){
        if(!e||e.name!=="AbortError")alert("Não foi possível criar o arquivo.");
      }
    });
  }

  $("f").addEventListener("submit",async function(ev){
    ev.preventDefault();
    var n=nome.value.trim(), ti=titulo.value.trim(), d=desc.value.trim();
    if(!n){err.textContent=editingId?"Informe seu nome para constar como editor.":"Informe seu nome para registrar a entrada.";nome.focus();return}
    if(!ti){err.textContent="Informe o título do registro.";titulo.focus();return}
    if(!d){err.textContent="Escreva a descrição do registro.";desc.focus();return}
    err.textContent="";

    // Pede a permissão logo no clique (o navegador exige um gesto do usuário)
    if(fileHandle&&needsPermission&&(await hasPermission(fileHandle,true))){
      needsPermission=false;showFile();
    }

    // Traz o que já existe no arquivo antes de gravar
    await syncFromFile();

    var wasEditing=!!editingId;

    if(wasEditing){
      var atual=entries.filter(function(x){return x.id===editingId})[0];
      if(!atual){
        stopEdit();
        err.textContent="O registro que você estava editando não foi encontrado.";
        return;
      }
      if(atual.titulo===ti&&atual.desc===d){
        err.textContent="Nenhuma alteração foi feita no registro.";
        return;
      }
      var atualizado={};
      Object.keys(atual).forEach(function(k){atualizado[k]=atual[k]});
      atualizado.titulo=ti;
      atualizado.desc=d;
      atualizado.editadoPor=n;
      atualizado.editadoEm=Date.now();
      var idAlvo=editingId;
      entries=entries.map(function(x){return x.id===idAlvo?atualizado:x});
    }else{
      entries.push({id:Date.now()+"-"+Math.random().toString(36).slice(2,7),nome:n,titulo:ti,desc:d,ts:Date.now()});
    }

    //save(NAME,n);
    nome.value="",titulo.value="";desc.value="";

    await persistData();
    if(wasEditing)stopEdit();else render();
  });

  // A busca só filtra a lista; não lê o arquivo a cada tecla
  $("q").addEventListener("input",render);

  /* ---------- Inicialização: reabre o arquivo do dia anterior ---------- */

  async function init(){
    render();
    showFile();
    if(!canFS)return;
    try{
      var h=await idbGet(HKEY);
      if(!h)return;
      fileHandle=h;
      if(await hasPermission(h,false)){
        var desatualizado=await syncFromFile();
        if(desatualizado)await persistData();else markSync();
      }else{
        needsPermission=true;
      }
      showFile();
      render();
    }catch(e){}
  }
  init();
})();