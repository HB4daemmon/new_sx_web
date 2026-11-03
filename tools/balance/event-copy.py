"""Event option quick-text rewrite: same rules, game voice instead of legalese.

Only `quick:` lines are touched. Unavailability clauses are dropped because the
UI already explains why a disabled option cannot be chosen.
"""
import glob, re, sys

RULES = [
    (r'[；，]\s*灵石不足或该法宝已满层时不能选。?', '。'),
    (r'[；，]\s*灵石不足时不能选。?', '。'),
    (r'[；，]\s*该法宝须能再叠两层且能存活，否则不能选。?', '。'),
    (r'[；，]\s*该法宝须能再叠两层否则不能选。?', '。'),
    (r'[；，]\s*该法宝已满层时不能选。?', '。'),
    (r'失手后?至少保留 ?1 ?点气血且无奖励?', '输了留一口气（至少 1 点气血），空手而归'),
    (r'失手至少保留 ?1 ?点且无奖', '输了留一口气（至少 1 点气血），空手而归'),
    (r'参加非致死试诀', '非致死切磋'),
    (r'参加非致死(问阵|试手|挑战)', r'非致死\1'),
    (r'[；，]\s*须有一层空位，?否则不能选。?', '。'),
    (r'[；，]\s*灵石不足不能选([，。])', r'\1'),
    (r'[；，]\s*灵石不足不能选。?', '。'),
    (r'；该法宝须能再叠两层且修为足够，否则不能选。?', '。'),
    (r'；灵石不足或未学适用功法不能选，', '；'),
    (r'；未学适用功法或资源不足则不能选。?', '。'),
    (r'，。', '。'),
    (r'。。', '。'),
]

def rewrite(line):
    if not re.match(r'^\s+quick: ', line):
        return line
    for pattern, repl in RULES:
        line = re.sub(pattern, repl, line)
    return line

if __name__ == '__main__':
    apply = '--apply' in sys.argv
    changed = 0
    for path in sorted(glob.glob('content/shanhai/events/*/*.yaml')):
        text = open(path, encoding='utf-8').read()
        lines = text.split('\n')
        out = [rewrite(line) for line in lines]
        for before, after in zip(lines, out):
            if before != after:
                changed += 1
                if not apply and changed <= 8:
                    print('-', before.strip()); print('+', after.strip())
        if apply:
            open(path, 'w', encoding='utf-8').write('\n'.join(out))
    print('changed lines:', changed)
