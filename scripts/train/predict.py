# 학습한 모델로 답만 내기 (10/26 AI 비교): 한 줄에 {"id", "messages":[system, user]} → {"secPer", "preds": {id: 답}}
#   python predict.py --data trained.jsonl --adapter out/adapter-2 --out trained-out.json --gpu_gb 8
import argparse, json, time

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--adapter')
ap.add_argument('--model', default='Qwen/Qwen2.5-1.5B-Instruct')
ap.add_argument('--gpu_gb', type=float, default=8)
ap.add_argument('--batch', type=int, default=8)
a = ap.parse_args()

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

rows = [json.loads(l) for l in open(a.data, encoding='utf-8') if l.strip()]
total = torch.cuda.get_device_properties(0).total_memory / 2**30
torch.cuda.set_per_process_memory_fraction(min(1.0, a.gpu_gb / total))
tok = AutoTokenizer.from_pretrained(a.adapter or a.model)
tok.padding_side = 'left'
model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16).cuda()
if a.adapter:
    model = PeftModel.from_pretrained(model, a.adapter)
model.eval()
preds = {}
t0 = time.time()
for i in range(0, len(rows), a.batch):
    b = rows[i : i + a.batch]
    enc = tok([tok.apply_chat_template(r['messages'][:2], tokenize=False, add_generation_prompt=True) for r in b], return_tensors='pt', padding=True, add_special_tokens=False).to('cuda')
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=320, do_sample=False, pad_token_id=tok.pad_token_id)
    for r, o in zip(b, out):
        preds[r['id']] = tok.decode(o[enc['input_ids'].shape[1]:], skip_special_tokens=True)
sec = (time.time() - t0) / len(rows)
json.dump({'secPer': sec, 'preds': preds}, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
print(json.dumps({'n': len(rows), 'secPer': round(sec, 3)}), flush=True)
