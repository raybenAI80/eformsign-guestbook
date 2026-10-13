# Chatterbox-Multilingual (MIT) Korean sample with built-in voice (conds.pt).
# usage: python -I chatterbox_gen.py <out_dir> [t3_model=v3]
import sys, time, os, torch, torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
out_dir = sys.argv[1]; t3 = sys.argv[2] if len(sys.argv) > 2 else "v3"
texts = ["방명록, 아직도 수기로 작성하고 직접 관리하시나요?",
         "열 분이 써도 문서는 한 장입니다. 다음 날 담당자 문서함에는 그 한 장만 있습니다."]
torch.set_num_threads(16)
t0 = time.time()
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu", t3_model=t3)
print("load", round(time.time() - t0, 1), "builtin conds:", m.conds is not None, flush=True)
for i, t in enumerate(texts, 1):
    t1 = time.time()
    torch.manual_seed(0)
    wav = m.generate(t, language_id="ko")  # no audio_prompt_path -> built-in voice
    p = f"{out_dir}/chatterbox-builtin-{t3}-{i}.wav"
    ta.save(p, wav, m.sr)
    print(p, m.sr, round(time.time() - t1, 1), "s", flush=True)
