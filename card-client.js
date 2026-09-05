(function () {
  'use strict';
  var scriptUrl=document.currentScript&&document.currentScript.src;
  var assetBase=scriptUrl?scriptUrl.slice(0,scriptUrl.lastIndexOf('/')+1):'';
  // AnkiWeb rewrites static media references, but not paths created by JS.
  // Resolve dynamic assets alongside this script, not alongside /study.
  if(location.protocol==='https:'&&!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
    var freshConfig=document.createElement('script');
    freshConfig.src=assetBase+'_ru-tutor-config.js?v='+Date.now();
    freshConfig.onload=mount;freshConfig.onerror=mount;
    (document.head||document.documentElement).appendChild(freshConfig);
  }else mount();
  function mount(){
  var root = document.getElementById('ru-tutor');
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = '1';
  var config = window.RuTutorConfig || {};
  var mobile = /iPhone|iPad|iPod|Macintosh.*Mobile/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
  var hosted = location.protocol==='https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var endpoint = (mobile || hosted) ? config.remote : (config.local || config.remote);
  var source = root.querySelector('.ru-tutor-context');
  var cardId = source.querySelector('[data-index]').textContent.trim();
  var phase = root.dataset.phase;
  function text(sel) { var el=source.querySelector(sel); return el ? el.textContent.trim() : ''; }
  var context={word:text('[data-word]'),translation:text('[data-translation]'),
    russian:text('[data-russian]'),english:text('[data-english]'),phase:phase};
  function getStore(k,def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (_) { return def; } }
  function setStore(k,v) { try { localStorage.setItem(k,JSON.stringify(v)); } catch (_) {} }
  var token=getStore('ru-tutor-token-v1','');
  var history=getStore('ru-tutor-history-v1',{});
  var messages=history[cardId] || [];
  var chatContext=context,chatKey=cardId;
  var cache=getStore('ru-tutor-alignments-v1',{});
  var busy=false,alignmentBusy=false;
  var connectionState=token?'paired':'unpaired';

  function el(tag,cls,value) { var n=document.createElement(tag);if(cls)n.className=cls;if(value)n.textContent=value;return n; }
  function button(value,handler) { var b=el('button','ru-button',value);b.type='button';b.addEventListener('click',handler);return b; }
  var panel=el('section','ru-tutor-panel');
  var heading=el('div','ru-tutor-heading');
  var brand=el('div','ru-brand');brand.appendChild(el('span','ru-avatar','L'));
  var brandText=el('div','ru-brand-text');brandText.appendChild(el('strong','','Luna'));brandText.appendChild(el('span','ru-brand-caption','Russian study desk'));brand.appendChild(brandText);heading.appendChild(brand);
  var headerActions=el('div','ru-header-actions');
  var connectionBadge=button(token?'Paired':'Connect',function(){showView('connect');});connectionBadge.classList.add('ru-connection-badge');headerActions.appendChild(connectionBadge);
  var settingsButton=button('⚙',function(){showView('settings');loadSettings();});settingsButton.classList.add('ru-icon-button');settingsButton.setAttribute('aria-label','Personalize Luna');headerActions.appendChild(settingsButton);
  var minimize=button('−',function(){
    if(!mobile&&window.innerWidth>=960){document.body.classList.remove('ru-tutor-open');setStore('ru-tutor-dock-open-v1',false);launcher.focus();return;}
    var collapsed=!content.hidden;content.hidden=collapsed;minimize.textContent=collapsed?'+':'−';minimize.setAttribute('aria-expanded',String(!collapsed));setStore('ru-tutor-collapsed-v1',collapsed);
  });minimize.classList.add('ru-icon-button');minimize.setAttribute('aria-label','Close or collapse tutor');headerActions.appendChild(minimize);
  heading.appendChild(headerActions);
  panel.appendChild(heading);
  var content=el('div','ru-tutor-content');panel.appendChild(content);
  var tabs=el('nav','ru-pane-tabs');tabs.setAttribute('aria-label','Study companion');
  var chatTab=button('Chat',resumeChat);chatTab.classList.add('ru-pane-tab');tabs.appendChild(chatTab);
  var vocabTab=button('Vocabulary',function(){showView('vocabulary');loadVocabulary();});vocabTab.classList.add('ru-pane-tab');tabs.appendChild(vocabTab);content.appendChild(tabs);
  var vocabView=el('section','ru-vocabulary');vocabView.hidden=true;content.appendChild(vocabView);
  var vocabData=null,vocabRating=0,vocabSelected=null,vocabLoadId=0;
  var wordHistory=[],wordHistoryIndex=-1,pendingLookup=null,dictionaryMap=null;
  var libraryHeader=el('header','ru-library-header');
  var closeLibrary=button('← Back to card',returnToCard);libraryHeader.appendChild(closeLibrary);
  var libraryTitle=el('div','ru-library-title');libraryTitle.appendChild(el('span','','RUSSIAN CORE 5000'));libraryTitle.appendChild(el('h2','','Vocabulary'));libraryHeader.appendChild(libraryTitle);
  var vocabSummary=el('div','ru-vocab-overview','Loading saved words…');libraryHeader.appendChild(vocabSummary);vocabView.appendChild(libraryHeader);
  var libraryBody=el('div','ru-library-body');vocabView.appendChild(libraryBody);
  var directory=el('aside','ru-library-directory');directory.setAttribute('aria-label','Word list');libraryBody.appendChild(directory);
  var vocabSearch=el('input','ru-vocab-search');vocabSearch.type='search';vocabSearch.placeholder='Search Russian or translation';vocabSearch.setAttribute('aria-label','Search vocabulary');directory.appendChild(vocabSearch);
  var vocabFilters=el('div','ru-vocab-filters');
  ['All','Again','Hard','Good','Easy'].forEach(function(label,i){var filter=button(label,function(){vocabRating=i;renderVocabulary();});filter.dataset.rating=String(i);vocabFilters.appendChild(filter);});directory.appendChild(vocabFilters);
  var vocabList=el('div','ru-vocab-list');directory.appendChild(vocabList);
  var vocabDetail=el('main','ru-vocab-detail');vocabDetail.setAttribute('aria-label','Word examples');libraryBody.appendChild(vocabDetail);
  var wordNavigation=el('nav','ru-word-navigation');wordNavigation.setAttribute('aria-label','Word selection history');
  var previousWord=button('← Back',function(){navigateWords(-1);}),nextWord=button('Forward →',function(){navigateWords(1);});previousWord.disabled=nextWord.disabled=true;
  wordNavigation.appendChild(previousWord);wordNavigation.appendChild(nextWord);libraryHeader.appendChild(wordNavigation);
  var libraryChat=el('aside','ru-library-chat');libraryChat.hidden=true;libraryChat.setAttribute('aria-label','Vocabulary Luna chat');libraryBody.appendChild(libraryChat);
  var libraryChatHeader=el('div','ru-library-chat-header');libraryChatHeader.appendChild(el('strong','','Luna'));
  libraryChatHeader.appendChild(button('← Back to examples',closeVocabularyChat));libraryChat.appendChild(libraryChatHeader);
  var vocabUpdated=el('p','ru-help');directory.appendChild(vocabUpdated);
  var vocabHelp=el('details','ru-vocab-help');vocabHelp.appendChild(el('summary','','How this list updates'));
  vocabHelp.appendChild(el('p','ru-help','One entry per studied word, using your latest Again, Hard, Good or Easy answer across both card directions. A recent rating is not a mastery test. PC ratings refresh automatically. For iPhone reviews, sync iPhone → PC → iPhone. Saved words and examples work offline.'));
  directory.appendChild(vocabHelp);
  vocabSearch.addEventListener('input',renderVocabulary);
  var chatView=el('div','ru-chat-view');content.appendChild(chatView);
  var contextBar=el('div','ru-card-context');var contextLabel=el('span','','THIS CARD'),contextWord=el('strong','',context.word);contextBar.appendChild(contextLabel);contextBar.appendChild(contextWord);
  var colorsBadge=el('span','ru-colors-badge','');contextBar.appendChild(colorsBadge);chatView.appendChild(contextBar);
  var chatExcerpt=el('div','ru-chat-excerpt');chatExcerpt.hidden=true;chatView.appendChild(chatExcerpt);
  var status=el('p','ru-tutor-status');status.setAttribute('role','status');chatView.appendChild(status);
  var connectView=el('div','ru-connect-view');connectView.hidden=true;content.appendChild(connectView);
  var backConnect=button('← Back to chat',resumeChat);backConnect.classList.add('ru-back-button');connectView.appendChild(backConnect);
  connectView.appendChild(el('h3','','Connect once. Keep studying.'));
  connectView.appendChild(el('p','ru-help','Open the Russian Anki Tutor shortcut on your PC and enter its code here. This device will remember the connection.'));
  var connectStatus=el('p','ru-tutor-status');connectStatus.setAttribute('role','status');connectView.appendChild(connectStatus);
  var diagnostics=el('details','ru-connection-details');
  diagnostics.appendChild(el('summary','','Troubleshooting'));
  diagnostics.appendChild(el('p','','Client v7 · '+(hosted?'web browser':mobile?'iPhone/iPad':'desktop')+' · '+endpoint+' · Origin: '+location.origin));
  diagnostics.appendChild(button('Test connection',async function(){
    try { await request('/health',null,false);connectStatus.textContent='PC reached successfully. Your saved pairing is kept; only use a new code if this device is not paired.'; }
    catch(error){connectStatus.textContent=error.message;}
  }));
  var pairing=el('div','ru-pairing');
  var pairInput=el('input','ru-pair-code');pairInput.type='text';pairInput.inputMode='numeric';pairInput.maxLength=14;
  pairInput.placeholder='0000000000';pairInput.autocomplete='off';pairInput.setAttribute('aria-label','Pairing code from your PC');
  pairing.appendChild(pairInput);
  pairing.appendChild(button('Connect',async function () {
    try {
      connectStatus.textContent='Connecting…';
      var result=await request('/pair',{code:pairInput.value.trim()},false);
      token=result.token;setStore('ru-tutor-token-v1',token);pairInput.value='';
      connected();resumeChat();checkConnection();
    } catch(error) {connectStatus.textContent=error.message;}
  }));
  connectView.appendChild(pairing);
  connectView.appendChild(el('p','ru-help','Chat needs your PC awake and online. Colors saved in the cards do not.'));
  connectView.appendChild(diagnostics);
  var log=el('div','ru-chat-log');log.setAttribute('aria-live','polite');chatView.appendChild(log);
  var composer=el('div','ru-composer');
  var input=el('textarea','ru-question');input.rows=2;input.maxLength=3000;
  input.placeholder='Ask Luna about this card…';input.setAttribute('aria-label','Ask the Russian tutor');
  composer.appendChild(input);
  var send=button('↑',sendQuestion);send.setAttribute('aria-label','Send message');composer.appendChild(send);
  var shortcuts=el('div','ru-shortcuts');
  shortcuts.appendChild(button('Explain this',function(){input.value='Explain the Russian word and its form in this sentence.';sendQuestion();}));
  shortcuts.appendChild(button('Grammar',function(){input.value='Explain the grammar and cases in this sentence.';sendQuestion();}));
  shortcuts.appendChild(button('Another example',function(){input.value='Give me one simple natural example with this word, with stress marks and an English translation.';sendQuestion();}));
  shortcuts.appendChild(button('Quiz me',function(){input.value='Ask me one short practice question about this card. Wait for my answer before explaining.';sendQuestion();}));
  chatView.appendChild(shortcuts);chatView.appendChild(composer);
  var footer=el('div','ru-chat-footer','Luna Max · Your personal tutor');chatView.appendChild(footer);
  var settingsPanel=el('section','ru-settings');settingsPanel.hidden=true;content.appendChild(settingsPanel);
  var backSettings=button('← Back to chat',resumeChat);backSettings.classList.add('ru-back-button');settingsPanel.appendChild(backSettings);
  settingsPanel.appendChild(el('h3','','Personalize Luna'));
  var settingsStatus=el('p','ru-tutor-status','Connect to edit settings shared by your PC and iPhone.');settingsPanel.appendChild(settingsStatus);
  var instructions=el('textarea','ru-question');instructions.rows=4;instructions.maxLength=4000;
  instructions.placeholder='Example: Answer in simple English. Explain each Russian case. Keep replies short and add one example.';
  instructions.setAttribute('aria-label','How Luna should answer');
  settingsPanel.appendChild(el('h4','ru-setting-section','1 / Your instructions'));
  settingsPanel.appendChild(el('label','ru-field-label','How should Luna answer you?'));settingsPanel.appendChild(instructions);
  settingsPanel.appendChild(el('p','ru-help','Only you can edit these. They take priority over Luna’s own guidance.'));
  var memoryLabel=el('label','ru-memory-toggle');
  var memoryToggle=el('input');memoryToggle.type='checkbox';memoryToggle.checked=true;
  memoryLabel.appendChild(memoryToggle);memoryLabel.appendChild(document.createTextNode(' Let Luna learn from our chats'));
  settingsPanel.appendChild(memoryLabel);
  var saveSettings=button('Save tutor settings',async function(){
    saveSettings.disabled=true;
    try{
      var result=await request('/settings',{instructions:instructions.value,memoryEnabled:memoryToggle.checked});
      settingsStatus.textContent='Your instructions and learning preference are saved for both devices.';drawAutomaticMemory(result);
      footer.textContent='Luna Max · '+(result.memoryEnabled?'Deck memory on':'Deck memory off');
    }catch(error){settingsStatus.textContent=error.message;}
    finally{saveSettings.disabled=false;}
  });saveSettings.disabled=true;settingsPanel.appendChild(saveSettings);
  settingsPanel.appendChild(el('h4','ru-setting-section','2 / Memory'));
  settingsPanel.appendChild(el('p','ru-help','Learning facts Luna selects from chats. Tell Luna in chat if something is wrong or should be forgotten.'));
  var automaticMemoryList=el('div','ru-automatic-memory');automaticMemoryList.setAttribute('aria-label','Automatic chat memory');settingsPanel.appendChild(automaticMemoryList);
  settingsPanel.appendChild(el('h4','ru-setting-section','3 / Luna’s own guidance'));
  settingsPanel.appendChild(el('p','ru-help','Teaching adjustments Luna writes for itself from your conversations. These cannot override your instructions.'));
  var guidanceList=el('div','ru-automatic-memory');guidanceList.setAttribute('aria-label','Luna self instructions');settingsPanel.appendChild(guidanceList);
  var confirmGuidance=button('Confirm: clear Luna’s guidance',async function(){try{drawAutomaticMemory(await request('/memory/clear',{confirm:true,kind:'guidance'}));confirmGuidance.hidden=true;}catch(error){settingsStatus.textContent=error.message;}});confirmGuidance.hidden=true;
  settingsPanel.appendChild(button('Clear Luna’s guidance',function(){confirmGuidance.hidden=false;}));settingsPanel.appendChild(confirmGuidance);
  var memoryView=el('div','ru-memory-view');
  settingsPanel.appendChild(button('View recent chat history',async function(){
    try{
      var result=await request('/memory');memoryView.textContent='';
      memoryView.appendChild(el('p','',result.total+' saved exchanges; showing the latest 20.'));
      result.entries.forEach(function(entry){var item=el('details');item.appendChild(el('summary','',entry.word+' — '+entry.question));item.appendChild(el('p','',entry.answer));memoryView.appendChild(item);});
    }catch(error){settingsStatus.textContent=error.message;}
  }));
  var confirmClear=button('Confirm: clear automatic memory and guidance',async function(){
    try{drawAutomaticMemory(await request('/memory/clear',{confirm:true}));memoryView.textContent='';settingsStatus.textContent='Automatic memory, guidance and chat history cleared. Your instructions are unchanged.';confirmClear.hidden=true;}
    catch(error){settingsStatus.textContent=error.message;}
  });confirmClear.hidden=true;
  settingsPanel.appendChild(button('Clear all automatic learning',function(){confirmClear.hidden=false;}));settingsPanel.appendChild(confirmClear);settingsPanel.appendChild(memoryView);
  var reset=button('Forget this device’s pairing',function(){reset.hidden=true;confirmReset.hidden=false;});reset.classList.add('ru-reconnect');connectView.appendChild(reset);
  var confirmReset=button('Confirm: forget pairing',function(){token='';setStore('ru-tutor-token-v1','');connected();confirmReset.hidden=true;reset.hidden=false;});confirmReset.hidden=true;connectView.appendChild(confirmReset);
  root.appendChild(panel);
  root.classList.add('ru-tutor-host');
  var launcher=button('Ask Luna ↗',function(){document.body.classList.add('ru-tutor-open');setStore('ru-tutor-dock-open-v1',true);returnToCard();});launcher.classList.add('ru-launcher');launcher.setAttribute('aria-label','Open Luna tutor sidebar');root.appendChild(launcher);
  document.body.classList.toggle('ru-tutor-open',!mobile&&!!getStore('ru-tutor-dock-open-v1',false));
  document.body.classList.remove('ru-library-open');
  document.querySelectorAll('.ru-permanent').forEach(function(span){
    span.addEventListener('click',function(event){
      event.stopPropagation();
      document.querySelectorAll('.ru-aligned').forEach(function(other){
        other.classList.toggle('ru-aligned-focus',other.dataset.group===span.dataset.group);
      });
    });
  });
  // Keep typing, Enter, and Space from triggering Anki's review shortcuts.
  panel.addEventListener('keydown',function(event){
    event.stopPropagation();
    if(vocabView.hidden)return;
    if(event.key==='Escape'){event.preventDefault();if(!libraryChat.hidden)closeVocabularyChat();else returnToCard();}
    if(event.key==='Tab'){
      var focusables=[].slice.call(vocabView.querySelectorAll('button:not(:disabled),input,textarea,audio[controls],summary,[tabindex="0"]')).filter(function(n){return n.getClientRects().length;});
      var first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  panel.addEventListener('keyup',function(event){event.stopPropagation();});
  panel.addEventListener('keypress',function(event){event.stopPropagation();});
  panel.addEventListener('click',function(event){event.stopPropagation();});
  input.addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendQuestion();}});

  function drawMessages() {
    log.textContent='';
    messages.forEach(function(message){
      var bubble=el('div','ru-bubble ru-'+message.role);
      bubble.appendChild(el('span','ru-message-author',message.role==='user'?'You':'Luna'));
      // Render just emphasis and plain text; model output never becomes HTML.
      message.text.split(/(\*\*[^*]+\*\*)/g).forEach(function(part){
        bubble.appendChild(part.startsWith('**')&&part.endsWith('**')?el('strong','',part.slice(2,-2)):document.createTextNode(part));
      });
      log.appendChild(bubble);
    });
    log.scrollTop=log.scrollHeight;
  }
  function saveMessages() {
    history=getStore('ru-tutor-history-v1',{});
    delete history[chatKey];history[chatKey]=messages.slice(-12);
    var keys=Object.keys(history);while(keys.length>30)delete history[keys.shift()];
    setStore('ru-tutor-history-v1',history);
  }
  async function request(route,data,auth) {
    if(!endpoint)throw Error('The iPhone connection is not configured yet.');
    var headers={};if(data)headers['Content-Type']='application/json';
    if(auth!==false&&token)headers.Authorization='Bearer '+token;
    var controller=new AbortController();var timer=setTimeout(function(){controller.abort();},15000);
    try {
      var response=await fetch(endpoint+route,{method:data?'POST':'GET',headers:headers,body:data?JSON.stringify(data):undefined,signal:controller.signal,cache:'no-store',credentials:'omit'});
      var result=await response.json();
      if(!response.ok){if(response.status===401){token='';setStore('ru-tutor-token-v1','');pairing.hidden=false;setConnection('unpaired');}throw Error(result.error||'Connection failed');}
      return result;
    } catch(error) {
      if(error.name==='AbortError'||error instanceof TypeError){setConnection(token?'offline':'unpaired');throw Error(token?'Your PC is offline or unreachable. Your pairing is still saved—keep the tutor running and try again.':'Could not reach the PC. Keep the tutor running; connection details are under Troubleshooting.');}
      throw error;
    } finally {clearTimeout(timer);}
  }
  async function job(data) {
    var start=await request('/jobs',data),deadline=Date.now()+200000;
    while(Date.now()<deadline) {
      await new Promise(function(resolve){setTimeout(resolve,1500);});
      var result=await request('/jobs/'+start.id);
      if(result.status==='done')return result.result;
      if(result.status==='error')throw Error(result.error);
    }
    throw Error('The tutor took too long. Try again.');
  }
  async function sendQuestion() {
    if(busy||!input.value.trim())return;
    if(!token){showView('connect');connectStatus.textContent='Connect once to send your question. Your draft is kept.';pairInput.focus();return;}
    busy=true;send.disabled=true;
    var question=input.value.trim();input.value='';
    messages.push({role:'user',text:question});drawMessages();saveMessages();
    status.textContent='Luna is thinking…';panel.classList.add('ru-thinking');
    try {
      var result=await job({kind:'chat',context:chatContext,messages:messages.slice(-11)});
      messages.push({role:'assistant',text:result.answer});saveMessages();
      if(root.isConnected){drawMessages();status.textContent='';setConnection('online');}
    } catch(error){if(root.isConnected){status.textContent=error.message;input.value=question;}}
    finally{busy=false;send.disabled=false;panel.classList.remove('ru-thinking');}
  }
  function tokens(node) {
    var matches=[],pattern=/[\p{L}\p{M}\p{N}]+(?:[-’'][\p{L}\p{M}\p{N}]+)*/gu,m;
    while((m=pattern.exec(node.textContent)))matches.push({text:m[0],start:m.index,end:pattern.lastIndex});
    return matches;
  }
  function targetIndices(node,ts) {
    var result=[],walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),offset=0,n;
    while((n=walker.nextNode())) {
      if(n.parentElement.closest('.ru-target'))ts.forEach(function(t,i){if(t.start>=offset&&t.end<=offset+n.length)result.push(i);});
      offset+=n.length;
    }
    return result;
  }
  function paint(node,ts,mapping,otherTokens,side) {
    // Work on text nodes so existing audio and red headword markup are preserved.
    var walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),nodes=[],offset=0,n;
    while((n=walker.nextNode())){nodes.push({node:n,start:offset});offset+=n.length;}
    nodes.forEach(function(entry){
      var changes=ts.map(function(t,i){return {t:t,i:i};}).filter(function(x){return mapping[x.i]&&x.t.start>=entry.start&&x.t.end<=entry.start+entry.node.length;});
      if(!changes.length)return;
      var frag=document.createDocumentFragment(),cursor=0;
      changes.forEach(function(x){
        var a=x.t.start-entry.start,b=x.t.end-entry.start,g=mapping[x.i];
        frag.appendChild(document.createTextNode(entry.node.data.slice(cursor,a)));
        var span=el('span','ru-aligned ru-color-'+g.color,entry.node.data.slice(a,b));
        span.dataset.group=g.id;span.title=g.other.map(function(i){return otherTokens[i].text;}).join(' ');
        span.addEventListener('click',function(event){
          event.stopPropagation();var pair=node.closest('[data-ru-pair]')||node.parentElement;
          document.querySelectorAll('.ru-aligned').forEach(function(s){s.classList.toggle('ru-aligned-focus',s.dataset.group===g.id);});
        });
        frag.appendChild(span);cursor=b;
      });
      frag.appendChild(document.createTextNode(entry.node.data.slice(cursor)));entry.node.replaceWith(frag);
    });
  }
  async function colorSentences() {
    if(phase!=='answer'||alignmentBusy)return;
    alignmentBusy=true;
    try {
    var sources=document.querySelectorAll('.ru-sentence-source');
    for(var p=0;p<sources.length;p++) {
      var ru=sources[p],en=document.querySelector('.ru-sentence-english[data-pair="'+ru.dataset.pair+'"]');
      if(!en||ru.dataset.aligned)continue;
      if(ru.querySelector('.ru-permanent')&&en.querySelector('.ru-permanent')){
        ru.dataset.aligned='1';
        colorsBadge.textContent='Colors saved ✓';
        continue;
      }
      var rt=tokens(ru),et=tokens(en);if(!rt.length||!et.length)continue;
      var key=JSON.stringify([context.word,ru.textContent,en.textContent]);
      try {
        if(!busy)status.textContent='Matching Russian and English meanings…';
        var data=cache[key];
        if(!data&&!token){status.textContent='Connect to generate sentence colors. Previously saved colors work offline.';continue;}
        if(!data){data=(await job({kind:'align',ru:rt.map(function(t){return t.text;}),en:et.map(function(t){return t.text;}),word:context.word})).alignment;cache[key]=data;
          var keys=Object.keys(cache);while(keys.length>200)delete cache[keys.shift()];setStore('ru-tutor-alignments-v1',cache);}
        if(!root.isConnected||!ru.isConnected)return;
        var target=targetIndices(ru,rt),rm={},em={},nextColor=1;
        data.groups.forEach(function(g,i){
          var color=g.ru.some(function(j){return target.indexOf(j)!==-1;})?0:1+(nextColor++-1)%11;
          var id=cardId+'-'+p+'-'+i;
          g.ru.forEach(function(j){rm[j]={color:color,id:id,other:g.en};});
          g.en.forEach(function(j){em[j]={color:color,id:id,other:g.ru};});
        });
        paint(ru,rt,rm,et,'ru');paint(en,et,em,rt,'en');ru.dataset.aligned='1';
        if(!busy)status.textContent='Matching colors show shared meaning. Tap a word to highlight its partner.';
      }catch(error){if(root.isConnected&&!busy)status.textContent=error.message;return;}
    }
    } finally {alignmentBusy=false;}
  }
  function connected() {
    pairing.hidden=!!token;composer.hidden=false;shortcuts.hidden=false;
    setConnection(token?'paired':'unpaired');
    status.textContent=token?'':'One-time setup: tap Connect to start chatting.';
    if(phase==='answer')colorSentences();
    if(!settingsPanel.hidden)loadSettings();
  }
  function showView(view){
    libraryChat.hidden=true;vocabView.classList.remove('ru-library-chat-open');
    if(view!=='vocabulary'){content.appendChild(chatView);libraryChat.hidden=true;vocabView.classList.remove('ru-library-chat-open');}
    chatView.hidden=view!=='chat';settingsPanel.hidden=view!=='settings';connectView.hidden=view!=='connect';vocabView.hidden=view!=='vocabulary';chatTab.setAttribute('aria-pressed',String(view==='chat'));vocabTab.setAttribute('aria-pressed',String(view==='vocabulary'));content.hidden=false;minimize.textContent='−';minimize.setAttribute('aria-expanded','true');
    panel.classList.toggle('ru-library-open',view==='vocabulary');document.body.classList.toggle('ru-library-open',view==='vocabulary');
    if(view==='vocabulary'){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Vocabulary library');closeLibrary.focus();}
    else{panel.removeAttribute('role');panel.removeAttribute('aria-modal');panel.removeAttribute('aria-label');}
  }
  function setChatContext(next,key){
    if(busy&&key!==chatKey){status.textContent='Wait for this reply before changing the chat topic.';return false;}
    if(key!==chatKey){saveMessages();chatKey=key;chatContext=next;history=getStore('ru-tutor-history-v1',{});messages=history[chatKey]||[];input.value='';drawMessages();status.textContent='';}
    contextLabel.textContent=chatKey===cardId?'THIS CARD':'VOCABULARY';contextWord.textContent=chatContext.word;
    chatExcerpt.textContent='';chatExcerpt.hidden=chatKey===cardId;
    if(!chatExcerpt.hidden){chatExcerpt.appendChild(el('p','',chatContext.russian||chatContext.translation));if(chatContext.russian)chatExcerpt.appendChild(el('p','ru-help',chatContext.english));}
    input.placeholder=chatKey===cardId?'Ask Luna about this card…':'Ask Luna about this word or sentence…';
    colorsBadge.hidden=chatKey!==cardId;
    return true;
  }
  function returnToCard(){
    if(!setChatContext(context,cardId))return;
    stopVocabularyAudio();showView('chat');vocabTab.focus();
  }
  function openVocabularyChat(word,example){
    var next={word:word.word,translation:word.translation,russian:example?example.ru:'',english:example?example.en:'',phase:'answer'};
    var key='vocab:'+word.id+':'+(example?example.ru+'|'+example.en:'word');
    if(!setChatContext(next,key))return;
    resumeChat();
  }
  function resumeChat(){if(chatKey!==cardId){showView('vocabulary');libraryChat.appendChild(chatView);chatView.hidden=false;libraryChat.hidden=false;vocabView.classList.add('ru-library-chat-open');}else showView('chat');input.focus();}
  function closeVocabularyChat(){libraryChat.hidden=true;chatView.hidden=true;vocabView.classList.remove('ru-library-chat-open');var ask=vocabDetail.querySelector('.ru-ask-word');if(ask)ask.focus();}
  function stopVocabularyAudio(){vocabView.querySelectorAll('audio').forEach(function(a){a.pause();});}
  function loadVocabulary(){
    vocabSummary.textContent='Loading your saved vocabulary…';
    var loadId=++vocabLoadId;
    root.querySelectorAll('script[data-vocabulary]').forEach(function(asset){asset.remove();});
    function loadAsset(file,done){
      var asset=document.createElement('script');asset.dataset.vocabulary='1';asset.src=assetBase+file+'?v='+Date.now();
      asset.onload=function(){if(loadId===vocabLoadId&&root.isConnected)done();};
      asset.onerror=function(){if(loadId===vocabLoadId)vocabSummary.textContent='Sync media on this device to download the vocabulary files.';};
      root.appendChild(asset);
    }
    loadAsset('_ru-vocabulary.js',function(){
      vocabData=window.RuVocabulary;
      if(!vocabData){vocabSummary.textContent='Sync the PC, then this device, to download your vocabulary.';return;}
      function ready(){
        if(!window.RuVocabularyExamples||window.RuVocabularyExamplesVersion!==vocabData.examplesVersion){vocabSummary.textContent='Word list and examples are from different syncs. Finish syncing media, then reopen Vocabulary.';return;}
        vocabData.examples=window.RuVocabularyExamples;dictionaryMap=null;renderVocabulary();resolveLookup();
      }
      if(window.RuVocabularyExamplesVersion===vocabData.examplesVersion&&window.RuVocabularyExamples)ready();else loadAsset('_ru-vocab-examples.js',ready);
    });
  }
  function renderVocabulary(){
    if(!vocabData)return;
    vocabView.classList.remove('ru-library-detail-open');
    var c=vocabData.counts;
    vocabSummary.textContent='';
    [[vocabData.reviewedWords,'WORDS STUDIED'],[(c['3']||0)+(c['4']||0),'GOOD + EASY']].forEach(function(stat){var box=el('div','ru-vocab-stat');box.appendChild(el('strong','',String(stat[0])));box.appendChild(el('span','',stat[1]));vocabSummary.appendChild(box);});
    vocabFilters.querySelectorAll('button').forEach(function(b){var rating=Number(b.dataset.rating);b.setAttribute('aria-pressed',String(rating===vocabRating));b.textContent=['All','Again','Hard','Good','Easy'][rating]+' '+(rating?(c[String(rating)]||0):vocabData.reviewedWords);});
    var query=vocabSearch.value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300\u0301]/g,'').normalize('NFC');
    var studied={};vocabData.words.forEach(function(w){studied[w.id]=w;});
    var pool=query&&window.RuVocabularyDictionary?window.RuVocabularyDictionary.words.map(function(w){return studied[w.id]||w;}):vocabData.words;
    var lemmaMatches=query?dictionaryEntries(vocabSearch.value).map(function(w){return w.id;}):[];
    var rows=pool.filter(function(w){var value=(w.word+' '+w.translation).toLocaleLowerCase().normalize('NFD').replace(/[\u0300\u0301]/g,'').normalize('NFC');return(!vocabRating||w.rating===vocabRating)&&(value.indexOf(query)!==-1||lemmaMatches.indexOf(w.id)!==-1);});
    rows.sort(function(a,b){return a.rating-b.rating||b.lastReview-a.lastReview;});
    vocabList.textContent='';
    if(!rows.length)vocabList.appendChild(el('p','ru-help','No words in this group yet.'));
    rows.forEach(function(word){
      var row=button('',function(){showWordExamples(word);});row.classList.add('ru-word-row');
      row.dataset.wordId=word.id;row.setAttribute('aria-pressed',String(vocabSelected&&vocabSelected.id===word.id));
      var wordText=el('span','ru-word-text');wordText.appendChild(el('strong','',word.word));wordText.appendChild(el('span','',word.translation));row.appendChild(wordText);
      var rating=el('span','ru-rating ru-rating-'+word.rating,['Not studied','Again','Hard','Good','Easy'][word.rating]);row.appendChild(rating);vocabList.appendChild(row);
    });
    vocabUpdated.textContent='Weakest first · '+vocabData.totalWords+' words in deck · Updated '+new Date(vocabData.updatedAt).toLocaleString();
    if(!vocabSelected){
      if(rows.length&&window.innerWidth>760)showWordExamples(rows.find(function(w){return normalizedWord(w.word)===normalizedWord(context.word);})||rows[0]);
      else{vocabDetail.textContent='';vocabDetail.appendChild(el('h3','','Examples'));vocabDetail.appendChild(el('p','ru-help','Choose a word to see where it appears throughout the deck.'));}
    }
  }
  function normalizedWord(value){return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300\u0301]/g,'').normalize('NFC').replace(/ё/g,'е');}
  function dictionaryEntries(value,key){
    var dict=window.RuVocabularyDictionary;if(!dict)return [];
    if(!dictionaryMap){dictionaryMap={};dict.words.forEach(function(w){var keys=w.word.indexOf(' ')<0?w.keys:[normalizedWord(w.word)];keys.forEach(function(k){(dictionaryMap[k]||(dictionaryMap[k]=[])).push(w);});});}
    var n=normalizedWord(value),lemma=key||dict.forms[n]||n;
    return dictionaryMap[n]||dictionaryMap[lemma]||[];
  }
  function makeLookup(span,value,key,translation){
    var entries=dictionaryEntries(value,key);
    span.classList.add('ru-lookup-word','tappable');span.tabIndex=0;span.setAttribute('role','button');
    var meaning=translation||entries.map(function(w){return w.word+' — '+w.translation;}).join('; ')||'No dictionary translation in this deck';
    span.title=meaning;span.setAttribute('aria-label',value+': '+meaning+'. Open vocabulary');
    var lookup=function(event){event.preventDefault();event.stopPropagation();var pair=span.closest('.ru-library-pair'),sentence=span.closest('.ru-sentence-source');var sentenceText=pair?pair.querySelector('.ru-example-russian').textContent:sentence?sentence.textContent:'';pendingLookup={value:value,key:key,translation:translation,sentence:sentenceText.trim()};showView('vocabulary');if(vocabData)resolveLookup();else loadVocabulary();};
    span.addEventListener('click',lookup);span.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' ')lookup(event);});
  }
  function resolveLookup(){
    if(!pendingLookup||!vocabData)return;var target=pendingLookup;pendingLookup=null;
    var entries=dictionaryEntries(target.value,target.key);vocabRating=0;vocabSearch.value=entries.length?entries[0].word:target.value;renderVocabulary();
    var found=entries[0]||{id:'lookup:'+normalizedWord(target.value),word:target.value,translation:target.translation||'No dictionary translation in this deck',keys:[target.key||normalizedWord(target.value)],examples:[]};
    if(!entries.length)vocabData.examples.forEach(function(e,i){if((e.ruTokens||[]).some(function(t){return t.k===target.key||normalizedWord(e.ru.slice(t.a,t.b))===normalizedWord(target.value);}))found.examples.push(i);});
    showWordExamples(Object.assign({},found,{selectedForm:target.value,baseWord:entries.length?found.word:(target.key||'Not found in this deck'),selectedExample:vocabData.examples.find(function(e){return e.ru===target.sentence;})}));
  }
  function navigateWords(delta){var index=wordHistoryIndex+delta;if(index<0||index>=wordHistory.length)return;wordHistoryIndex=index;var entry=wordHistory[index];vocabSearch.value=entry.query;vocabRating=entry.rating;renderVocabulary();showWordExamples(entry.word,true);}
  function enableCardLookups(){
    document.querySelectorAll('.ru-sentence-source').forEach(function(sentence){
      var walker=document.createTreeWalker(sentence,NodeFilter.SHOW_TEXT),nodes=[],n;while((n=walker.nextNode()))if(!n.parentElement.closest('.ru-lookup-word,a,button,audio,script,style'))nodes.push(n);
      nodes.forEach(function(node){var value=node.textContent,pattern=/[\p{L}\p{M}]+(?:[-’'][\p{L}\p{M}]+)*/gu,m,cursor=0,fragment=document.createDocumentFragment();
        while((m=pattern.exec(value))){fragment.appendChild(document.createTextNode(value.slice(cursor,m.index)));var span=el('span','',m[0]);var aligned=node.parentElement.closest('.ru-permanent');makeLookup(span,m[0],null,aligned&&aligned.title);fragment.appendChild(span);cursor=pattern.lastIndex;}
        fragment.appendChild(document.createTextNode(value.slice(cursor)));node.replaceWith(fragment);
      });
    });
  }
  function renderExampleSentence(node,value,ts,word,hitGroups,other,side){
    var cursor=0;
    (ts||[]).forEach(function(t){
      if(!Number.isInteger(t.a)||!Number.isInteger(t.b)||t.a<cursor||t.b>value.length||t.b<=t.a)return;
      node.appendChild(document.createTextNode(value.slice(cursor,t.a)));
      var tokenText=value.slice(t.a,t.b),span=el('span','',tokenText);
      var hit=side==='ru'?(word.keys||[normalizedWord(word.word)]).some(function(k){return k===t.k||k===normalizedWord(tokenText);}):hitGroups.has(t.g);
      if(Number.isInteger(t.c)&&t.c>=0&&t.c<=11){span.classList.add('ru-color-'+t.c);span.dataset.color=String(t.c);}
      if(hit)span.classList.add('ru-vocab-hit');
      if(Number.isInteger(t.g)){
        span.dataset.group=String(t.g);span.classList.add('ru-aligned','tappable');span.tabIndex=0;span.setAttribute('role','button');
        span.title=(other.tokens||[]).filter(function(o){return o.g===t.g;}).map(function(o){return other.text.slice(o.a,o.b);}).join(' ');
        var highlight=function(event){event.stopPropagation();var pair=node.closest('.ru-library-pair');pair.querySelectorAll('[data-group]').forEach(function(s){s.classList.toggle('ru-aligned-focus',s.dataset.group===String(t.g));});};
        if(side!=='ru'){span.addEventListener('click',highlight);span.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();highlight(event);}});}
      }
      if(side==='ru')makeLookup(span,tokenText,t.k,span.title);
      node.appendChild(span);cursor=t.b;
    });
    node.appendChild(document.createTextNode(value.slice(cursor)));
  }
  function showWordExamples(word,fromHistory){
    stopVocabularyAudio();
    if(!fromHistory&&(!wordHistory[wordHistoryIndex]||wordHistory[wordHistoryIndex].word.id!==word.id||wordHistory[wordHistoryIndex].word.selectedForm!==word.selectedForm)){wordHistory=wordHistory.slice(0,wordHistoryIndex+1);wordHistory.push({word:word,query:vocabSearch.value,rating:vocabRating});if(wordHistory.length>100)wordHistory.shift();wordHistoryIndex=wordHistory.length-1;}
    previousWord.disabled=wordHistoryIndex<=0;nextWord.disabled=wordHistoryIndex>=wordHistory.length-1;
    vocabSelected=word;vocabView.classList.add('ru-library-detail-open');vocabDetail.textContent='';vocabDetail.scrollTop=0;
    vocabList.querySelectorAll('[data-word-id]').forEach(function(row){row.setAttribute('aria-pressed',String(row.dataset.wordId===word.id));});
    var back=button('← Word list',function(){vocabView.classList.remove('ru-library-detail-open');vocabSearch.focus();});back.classList.add('ru-back-button','ru-word-list-back');vocabDetail.appendChild(back);
    vocabDetail.appendChild(el('p','ru-selected-form-label','SELECTED WORD'));
    vocabDetail.appendChild(el('h3','',word.selectedForm||word.word));
    var base=el('p','ru-base-word');base.appendChild(el('span','','Base form: '));base.appendChild(el('strong','',word.baseWord||word.word));vocabDetail.appendChild(base);
    vocabDetail.appendChild(el('p','ru-help',word.translation));
    if(word.selectedExample){var selected=el('div','ru-selected-sentence');selected.appendChild(el('span','ru-selected-form-label','SELECTED SENTENCE'));var example=word.selectedExample;var text=el('p','ru-example-russian');renderExampleSentence(text,example.ru,example.ruTokens,word,new Set(),{text:example.en,tokens:example.enTokens},'ru');selected.appendChild(text);vocabDetail.appendChild(selected);}
    var askWord=button('Ask Luna about '+(word.selectedForm||word.word),function(){openVocabularyChat(word,word.selectedExample);});askWord.classList.add('ru-ask-word');vocabDetail.appendChild(askWord);
    vocabDetail.appendChild(el('p','ru-help',word.examples.length+' matching examples across the deck, including inflected forms.'));
    var shown=0;var examples=el('div','ru-example-list');vocabDetail.appendChild(examples);
    var more=button('Show more examples',addExamples);vocabDetail.appendChild(more);
    function addExamples(){
      word.examples.slice(shown,shown+20).forEach(function(id){
        var example=vocabData.examples[id];if(!example)return;
        var item=el('article','ru-example ru-library-pair');
        var hitGroups=new Set();(example.ruTokens||[]).forEach(function(t){if((word.keys||[]).some(function(k){return k===t.k||k===normalizedWord(example.ru.slice(t.a,t.b));})&&Number.isInteger(t.g))hitGroups.add(t.g);});
        var ru=el('p','ru-example-russian'),en=el('p','ru-example-translation');
        renderExampleSentence(ru,example.ru,example.ruTokens,word,hitGroups,{text:example.en,tokens:example.enTokens},'ru');
        renderExampleSentence(en,example.en,example.enTokens,word,hitGroups,{text:example.ru,tokens:example.ruTokens},'en');
        item.appendChild(ru);item.appendChild(en);
        item.appendChild(el('span','ru-example-color-status',example.colored?'Saved translation colors':'Translation colors not generated yet'));
        var actions=el('div','ru-example-actions');
        actions.appendChild(button('Ask Luna about this sentence',function(){openVocabularyChat(word,example);}));
        var recordings=(example.audio||[]).filter(function(name){return typeof name==='string'&&name.length&&name!=='.'&&name!=='..'&&!/[\/\\:\x00-\x1f]/.test(name);});
        if(!recordings.length)actions.appendChild(el('span','ru-help','No recording in this deck'));
        recordings.forEach(function(name,i){
          var audio=el('audio','ru-example-audio');audio.controls=true;audio.preload='none';audio.src=assetBase+encodeURIComponent(name);audio.setAttribute('aria-label','Listen to Russian sentence'+(recordings.length>1?' '+(i+1):''));
          audio.addEventListener('play',function(){vocabView.querySelectorAll('audio').forEach(function(other){if(other!==audio)other.pause();});});
          audio.addEventListener('error',function(){if(!audio.nextElementSibling||!audio.nextElementSibling.classList.contains('ru-audio-error'))audio.after(el('span','ru-help ru-audio-error','Audio unavailable. Finish syncing media on this device.'));});
          actions.appendChild(audio);
        });item.appendChild(actions);
        examples.appendChild(item);
      });
      shown+=20;more.hidden=shown>=word.examples.length;
    }
    addExamples();
  }
  function setConnection(value){connectionState=value;connectionBadge.dataset.state=value;connectionBadge.textContent={online:'Connected',paired:'Paired',offline:'PC offline',unpaired:'Connect'}[value];}
  async function checkConnection(){
    if(!token)return;
    try{var result=await request('/settings');if(root.isConnected){setConnection('online');footer.textContent='Luna Max · '+(result.memoryEnabled?'Deck memory on':'Deck memory off');}}
    catch(error){if(root.isConnected){setConnection(token?'offline':'unpaired');}}
  }
  async function loadSettings(){
    saveSettings.disabled=true;
    if(!token){settingsStatus.textContent='Connect first to load or change your settings.';return;}
    settingsStatus.textContent='Loading deck settings…';
    try{
      var result=await request('/settings');
      instructions.value=result.instructions;memoryToggle.checked=result.memoryEnabled;drawAutomaticMemory(result);
      settingsStatus.textContent='Shared by your paired devices. Saved on your PC, separate from ChatGPT memory.';saveSettings.disabled=false;
    }catch(error){settingsStatus.textContent=error.message;}
  }
  function drawAutomaticMemory(result){
    [[automaticMemoryList,result.automaticMemory,'No learning facts saved yet. Luna will select useful ones from chats.'],[guidanceList,result.selfInstructions,'No self-written guidance yet.']].forEach(function(section){
      section[0].textContent='';var entries=section[1]||[];
      if(!entries.length)section[0].appendChild(el('p','ru-help',section[2]));
      entries.forEach(function(entry){var note=el('div','ru-memory-note');note.appendChild(el('p','',entry.text));if(entry.evidence){var evidence=el('details');evidence.appendChild(el('summary','','From your chat'));evidence.appendChild(el('p','',entry.evidence));note.appendChild(evidence);}section[0].appendChild(note);});
    });
  }
  drawMessages();connected();
  if(window.RuVocabularyDictionary)enableCardLookups();else{var lookupAsset=el('script');lookupAsset.src=assetBase+'_ru-vocab-examples.js?v='+Date.now();lookupAsset.onload=enableCardLookups;root.appendChild(lookupAsset);}
  chatTab.setAttribute('aria-pressed','true');vocabTab.setAttribute('aria-pressed','false');
  content.hidden=!!getStore('ru-tutor-collapsed-v1',false);minimize.textContent=content.hidden?'+':'−';minimize.setAttribute('aria-expanded',String(!content.hidden));
  if(token)checkConnection();
  }
}());
