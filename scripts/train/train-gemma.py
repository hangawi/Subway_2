# 젬마 4 31B (A100의 QAT 4비트 모델) 위에 LoRA 학습 (10/28 예형님 2부)
# - 4비트(compressed-tensors)를 bf16으로 풀어 올리고 언어 부분에만 LoRA (이미지·소리 부분은 안 건드림)
# - 정답(assistant) 글자에서만 배움, 지시문·손님 말은 배우지 않음
# - 서비스는 vLLM이 같은 4비트 모델 위에 이 어댑터를 얹어서 씀 (--enable-lora)
#   python train-gemma.py --data train.jsonl --out out/gemma-subway --model ~/sophia-ai/models/gemma-4-31B-it-qat [--device cpu --max_steps 1 --limit 2]
import argparse, json, math, random, time

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--model', required=True)
ap.add_argument('--device', default='cuda')
ap.add_argument('--epochs', type=float, default=1)
ap.add_argument('--lr', type=float, default=1e-4)
ap.add_argument('--accum', type=int, default=8)
ap.add_argument('--max_len', type=int, default=6144)
ap.add_argument('--max_steps', type=int, default=0)
ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--rank', type=int, default=16)
a = ap.parse_args()

import torch
from transformers import AutoModelForImageTextToText, AutoTokenizer
from transformers.utils.quantization_config import CompressedTensorsConfig
from peft import LoraConfig, get_peft_model

t0 = time.time()
tok = AutoTokenizer.from_pretrained(a.model)
rows = [json.loads(l) for l in open(a.data, encoding='utf-8') if l.strip()]
if a.limit:
    rows = rows[: a.limit]
random.Random(1028).shuffle(rows)

def encode(r):
    msgs = r['messages']
    prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True)
    full = prompt + msgs[2]['content'] + tok.eos_token if isinstance(tok.eos_token, str) else prompt + msgs[2]['content']
    p_ids = tok(prompt, add_special_tokens=False)['input_ids']
    f_ids = tok(full, add_special_tokens=False)['input_ids'][: a.max_len]
    labels = [-100] * min(len(p_ids), len(f_ids)) + f_ids[len(p_ids):]
    return torch.tensor(f_ids), torch.tensor(labels[: len(f_ids)])

data = [encode(r) for r in rows]
lens = sorted(len(x[0]) for x in data)
print(json.dumps({'rows': len(data), 'tokens_p50': lens[len(lens) // 2], 'tokens_max': lens[-1], 'load_sec': round(time.time() - t0)}), flush=True)

model = AutoModelForImageTextToText.from_pretrained(
    a.model,
    dtype=torch.bfloat16,
    quantization_config=CompressedTensorsConfig(run_compressed=False),  # 4비트를 bf16으로 풀어서
    device_map={'': a.device} if a.device != 'cpu' else None,
    low_cpu_mem_usage=True,
)
model.config.use_cache = False
model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
model.enable_input_require_grads()
cfg = LoraConfig(r=a.rank, lora_alpha=a.rank * 2, lora_dropout=0.05, bias='none', task_type='CAUSAL_LM',
                 target_modules=r'.*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)')
model = get_peft_model(model, cfg)
model.print_trainable_parameters()
print(json.dumps({'model_sec': round(time.time() - t0), 'gpu_gb': round(torch.cuda.memory_allocated() / 2**30, 1) if a.device == 'cuda' else None}), flush=True)

opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.0)
total = math.ceil(len(data) * a.epochs / a.accum)
if a.max_steps:
    total = min(total, a.max_steps)
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 10) * max(0.0, 1 - s / max(1, total)))
model.train()
step, i, losses = 0, 0, []
while step < total:
    ids, lab = data[i % len(data)]
    i += 1
    out = model(input_ids=ids[None].to(a.device), labels=lab[None].to(a.device))
    (out.loss / a.accum).backward()
    losses.append(out.loss.item())
    if i % a.accum == 0:
        torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
        opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
        step += 1
        if step % 5 == 0 or step == total:
            print(json.dumps({'step': step, 'of': total, 'loss': round(sum(losses[-a.accum * 5:]) / len(losses[-a.accum * 5:]), 4), 'sec': round(time.time() - t0), 'gpu_gb': round(torch.cuda.max_memory_allocated() / 2**30, 1) if a.device == 'cuda' else None}), flush=True)
model.save_pretrained(a.out)
tok.save_pretrained(a.out)
print(json.dumps({'saved': a.out, 'sec': round(time.time() - t0)}), flush=True)
