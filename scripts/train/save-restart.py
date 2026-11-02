# A100: 지금 돌고 있는 vLLM(젬마·whisper) 실행 명령을 그대로 저장 (접속 키 포함 — 파일은 본인만 읽기, 화면에 안 냄)
#   python3 save-restart.py  → ~/subway-train/restart/{gemma,whisper,gemma-lora}.sh
import os, shlex, stat, subprocess

home = os.path.expanduser('~')
d = os.path.join(home, 'subway-train', 'restart')
os.makedirs(d, exist_ok=True)
os.chmod(d, 0o700)
pids = subprocess.run(['pgrep', '-f', 'vllm serve'], capture_output=True, text=True).stdout.split()
found = {}
for pid in pids:
    try:
        args = open(f'/proc/{pid}/cmdline', 'rb').read().split(b'\0')
    except OSError:
        continue
    args = [a.decode() for a in args if a]
    if 'serve' not in args:
        continue
    name = 'gemma' if any('gemma-4' in a for a in args) else 'whisper' if any('whisper' in a for a in args) else None
    if not name or name in found:
        continue
    cwd = os.readlink(f'/proc/{pid}/cwd')
    found[name] = (cwd, args)
for name, (cwd, args) in found.items():
    body = f"#!/bin/bash\ncd {shlex.quote(cwd)}\nexport VLLM_USE_FLASHINFER_SAMPLER=0\nexec {shlex.join(args)} \"$@\"\n"
    p = os.path.join(d, f'{name}.sh')
    open(p, 'w').write(body)
    os.chmod(p, stat.S_IRWXU)
    print('saved', name, 'cwd', cwd, 'args', len(args))
if 'gemma' in found:
    adapter = os.path.join(home, 'subway-train', 'out', 'gemma-subway')
    p = os.path.join(d, 'gemma-lora.sh')
    open(p, 'w').write(f"#!/bin/bash\nexec {shlex.quote(os.path.join(d, 'gemma.sh'))} --enable-lora --max-lora-rank 16 --lora-modules subway={shlex.quote(adapter)}\n")
    os.chmod(p, stat.S_IRWXU)
    print('saved gemma-lora')
