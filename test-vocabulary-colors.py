from vocabulary import sentence_tokens,norm,audio_files
assert audio_files('[sound:hello world.mp3][sound:hello world.mp3][sound:../secret.mp3][sound:https://evil/x.mp3][sound:good%20.mp3]')==['hello world.mp3','good%20.mp3']
groups={}
ru,rt,saved=sentence_tokens('😀 <span class="ru-permanent ru-color-0" data-group="g">ко</span> врачу.',groups,lambda w:'к' if w=='ко' else norm(w))
en,et,en_saved=sentence_tokens('Go <span class="ru-permanent ru-color-0" data-group="g">to</span> a doctor.',groups)
assert ru=='😀 ко врачу.' and rt[0]['a']==3 and rt[0]['b']==5
assert rt[0]['k']=='к' and rt[0]['c']==0 and rt[0]['g']==et[1]['g']
assert saved and en_saved
_,unsafe,_=sentence_tokens('<span class="ru-permanent ru-color-999" onclick="bad()">hello</span>',{})
assert 'c' not in unsafe[0]
_,target,_=sentence_tokens('<span class="ru-target">же</span>',{})
assert target[0]['c']==0
print('PASS: saved shared colors, inflected selected-word keys, UTF-16 offsets and bounded metadata; no raw HTML export.')
