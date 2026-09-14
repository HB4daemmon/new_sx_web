from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

presentation=ROOT/'data/presentation.json'
text=presentation.read_text()
old='"revision": "16.0"'
assert text.count(old)==1
presentation.write_text(text.replace(old,'"revision": "16.1"',1))

contract=ROOT/'tests/combat-feedback.test.mjs'
text=contract.read_text()
assert "UI_REVISION='16.0'" in text
assert "revision,'16.0'" in text
text=text.replace("test('UI16 preserves the sprite packaging contract'","test('UI16.1 preserves the sprite packaging contract'",1)
text=text.replace("UI_REVISION='16.0'","UI_REVISION='16.1'",1)
text=text.replace("revision,'16.0'","revision,'16.1'",1)
contract.write_text(text)

print('Aligned presentation contract to UI 16.1')
