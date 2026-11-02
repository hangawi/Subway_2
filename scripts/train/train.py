# 써브웨이 말 → JSON 학습 (10/20 밤, 학습 1번) — A100의 ~/subway-train 안에서만 돌린다.
# 작은 모델(Qwen2.5-1.5B-Instruct)에 LoRA. 지금 쓰는 gemma(vllm 8022)와 다른 프로그램은 건드리지 않는다.
# GPU 메모리는 최대 12GB까지만 (남은 약 14GB 안에서): torch.cuda.set_per_process_memory_fraction
#   python train.py --data train.jsonl --out out/adapter-1 [--epochs 2]
import argparse, json, math, random, time
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--model', default='Qwen/Qwen2.5-1.5B-Instruct')
ap.add_argument('--epochs', type=float, default=2)
ap.add_argument('--lr', type=float, default=2e-4)
ap.add_argument('--batch', type=int, default=2)
ap.add_argument('--accum', type=int, default=4)  # 2문장씩 4번 모아 한 번 반영 (= 8문장) — 메모리 적게 (10/20: 8문장씩은 12GB 넘어 멈춤)
ap.add_argument('--max_len', type=int, default=1024)
ap.add_argument('--gpu_gb', type=float, default=12)
a = ap.parse_args()

total = torch.cuda.get_device_properties(0).total_memory / 2**30
torch.cuda.set_per_process_memory_fraction(min(1.0, a.gpu_gb / total))
random.seed(1020)
torch.manual_seed(1020)

tok = AutoTokenizer.from_pretrained(a.model)
tok.padding_side = 'right'
rows = [json.loads(l) for l in open(a.data, encoding='utf-8') if l.strip()]

def encode(msgs):
    prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True)
    full = prompt + msgs[2]['content'] + tok.eos_token
    p_ids = tok(prompt, add_special_tokens=False)['input_ids']
    ids = tok(full, add_special_tokens=False)['input_ids'][: a.max_len]
    labels = [-100] * min(len(p_ids), len(ids)) + ids[len(p_ids):]
    return ids, labels[: len(ids)]

data = [encode(r['messages']) for r in rows]
print(f'examples {len(data)}, max tokens {max(len(x[0]) for x in data)}', flush=True)

model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16).cuda()
model.gradient_checkpointing_enable()
model.enable_input_require_grads()
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type='CAUSAL_LM', target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']))
model.print_trainable_parameters()
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.0)
steps = math.ceil(len(data) / (a.batch * a.accum) * a.epochs)
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 30) * max(0.0, 1 - s / steps))

model.train()
t0 = time.time()
step = 0
micro = 0
while step < steps:
    random.shuffle(data)
    for i in range(0, len(data), a.batch):
        if step >= steps:
            break
        b = data[i : i + a.batch]
        n = max(len(x[0]) for x in b)
        ids = torch.tensor([x[0] + [tok.pad_token_id] * (n - len(x[0])) for x in b]).cuda()
        lab = torch.tensor([x[1] + [-100] * (n - len(x[1])) for x in b]).cuda()
        att = torch.tensor([[1] * len(x[0]) + [0] * (n - len(x[0])) for x in b]).cuda()
        loss = model(input_ids=ids, attention_mask=att, labels=lab).loss / a.accum
        loss.backward()
        micro += 1
        if micro % a.accum:
            continue
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        opt.zero_grad()
        step += 1
        if step % 20 == 0 or step == 1:
            print(f'step {step}/{steps} loss {loss.item() * a.accum:.4f} {time.time() - t0:.0f}s mem {torch.cuda.max_memory_allocated() / 2**30:.1f}GB', flush=True)
model.save_pretrained(a.out)
tok.save_pretrained(a.out)
print(f'done {time.time() - t0:.0f}s → {a.out}', flush=True)
