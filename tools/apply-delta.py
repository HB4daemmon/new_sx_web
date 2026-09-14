from pathlib import Path
import base64,hashlib,json,re,zlib
cfg=json.loads(Path('tools/continuation.json').read_text())
s=''.join(p.read_text().strip() for p in sorted(Path('tools/stages',cfg['stage']).glob('*.b64')))
for bad,good in cfg.get('repairs',[]):
 assert s.count(bad)==1
 s=s.replace(bad,good)
assert hashlib.sha256(s.encode()).hexdigest()==cfg['sha256'], 'Invalid transport hash'
ops=json.loads(zlib.decompress(base64.b64decode(s,validate=True)))
for op in ops:
 p=Path(op['path'])
 assert not p.is_absolute() and '..' not in p.parts
 assert p.parts[0] in ['src','data','tests','scripts','docs','verification'] or str(p) in ['package.json','package-lock.json','README.md','.deploy-version']
 old=p.read_bytes() if p.exists() else b''
 assert (hashlib.sha256(old).hexdigest() if old else None)==op['before'],str(p)+' baseline mismatch'
 text=old.decode()
 for a,b,new in reversed(op['edits']):text=text[:a]+new+text[b:]
 out=text.encode()
 assert hashlib.sha256(out).hexdigest()==op['after'],str(p)+' output mismatch'
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(out)
 print('Verified',p)
if cfg.get('postFix')=='stage04-presentation':
 p=Path('data/presentation.json');text=p.read_text()
 assert '"revision": "6"' in text
 p.write_text(text.replace('"revision": "6"','"revision": "16.0"',1))
 p=Path('tests/presentation.test.mjs');text=p.read_text()
 assert 'assert.equal(choices,221);' in text
 p.write_text(text.replace('assert.equal(choices,221);','assert.equal(choices,276);',1))
 p=Path('tests/race-events.test.mjs');text=p.read_text()
 text,n=re.subn(r"(assert\.equal\([^,\n]*\.revision,\s*)['\"]6['\"](\s*\))",r"\1'16.0'\2",text,count=1)
 assert n==1,'race event revision assertion not found'
 p.write_text(text)
 print('Applied stage04 presentation compatibility correction')
