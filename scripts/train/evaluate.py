# 학습한 모델 시험 (10/20 밤): 시험지(test.jsonl)에 답을 내고 정답(규칙 결과, 이름 모양)과 칸별로 비교
#   python evaluate.py --data test.jsonl --adapter out/adapter-1 --out eval-ft.json
#   python evaluate.py --score preds.jsonl --data test.jsonl --out eval-gemma.json   (다른 모델의 답을 같은 기준으로 점수만)
import argparse, json, time

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--adapter')
ap.add_argument('--model', default='Qwen/Qwen2.5-1.5B-Instruct')
ap.add_argument('--score', help='이미 낸 답 (한 줄에 JSON 하나, 시험지 순서)')
ap.add_argument('--gpu_gb', type=float, default=12)
ap.add_argument('--batch', type=int, default=8)
a = ap.parse_args()

rows = [json.loads(l) for l in open(a.data, encoding='utf-8') if l.strip()]
want = [json.loads(r['messages'][2]['content']) for r in rows]
texts = [r['messages'][1]['content'] for r in rows]

def flat(o, pre=''):
    out = {}
    for k, v in (o or {}).items():
        if isinstance(v, dict):
            out.update(flat(v, pre + k + '.'))
        else:
            # 목록은 정렬해서 비교 (글자만 든 목록일 때 — 학습 안 한 모델은 목록 안에 묶음을 넣기도 함)
            out[pre + k] = sorted(v) if isinstance(v, list) and all(isinstance(x, (str, int, float)) for x in v) else v
    return out

preds, secs = [], 0.0
if a.score:
    preds = [l.rstrip('\n') for l in open(a.score, encoding='utf-8')]
else:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    total = torch.cuda.get_device_properties(0).total_memory / 2**30
    torch.cuda.set_per_process_memory_fraction(min(1.0, a.gpu_gb / total))
    tok = AutoTokenizer.from_pretrained(a.adapter or a.model)
    tok.padding_side = 'left'
    model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16).cuda()
    if a.adapter:
        model = PeftModel.from_pretrained(model, a.adapter)
    model.eval()
    t0 = time.time()
    for i in range(0, len(rows), a.batch):
        b = [tok.apply_chat_template(r['messages'][:2], tokenize=False, add_generation_prompt=True) for r in rows[i : i + a.batch]]
        enc = tok(b, return_tensors='pt', padding=True, add_special_tokens=False).to('cuda')
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=320, do_sample=False, pad_token_id=tok.pad_token_id)
        preds += [tok.decode(o[enc['input_ids'].shape[1]:], skip_special_tokens=True) for o in out]
    secs = (time.time() - t0) / len(rows)

valid = exact = halluc = miss = 0
field_ok, field_n, fails = {}, {}, []
for t, w, p in zip(texts, want, preds):
    try:
        got = json.loads(p)
        if not isinstance(got, dict):
            raise ValueError('not object')
        valid += 1
    except Exception:
        fails.append({'text': t, 'error': 'JSON 아님', 'pred': p[:200]})
        continue
    fw, fg = flat(w), flat(got)
    bad = []
    for k, v in fw.items():
        g = fg.get(k)
        field_n[k] = field_n.get(k, 0) + 1
        if g == v or (v is None and g in (None, [], 'NONE') and k != 'options.sauces'):
            field_ok[k] = field_ok.get(k, 0) + 1
        else:
            bad.append(f'{k}: 정답 {v} / 답 {g}')
            if v is None:
                halluc += 1
            else:
                miss += 1
    if not bad:
        exact += 1
    elif len(fails) < 80:
        fails.append({'text': t, 'bad': bad})
n = len(rows)
summary = {
    'n': n, 'json_ok': valid, 'exact': exact, 'exact_pct': round(exact / n * 100, 1),
    'invented_fields': halluc, 'missed_fields': miss, 'sec_per_sentence': round(secs, 3),
    'fields_worst': sorted([(k, round(field_ok.get(k, 0) / field_n[k] * 100, 1)) for k in field_n], key=lambda x: x[1])[:8],
}
json.dump({'summary': summary, 'fails': fails}, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(summary, ensure_ascii=False), flush=True)
