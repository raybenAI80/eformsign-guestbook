import sys, time, torch, soundfile as sf
from qwen_tts import Qwen3TTSModel
out_dir, speaker = sys.argv[1], sys.argv[2]
texts = ["방명록, 아직도 수기로 작성하고 직접 관리하시나요?",
         "열 분이 써도 문서는 한 장입니다. 다음 날 담당자 문서함에는 그 한 장만 있습니다."]
torch.set_num_threads(16)
t0=time.time()
m = Qwen3TTSModel.from_pretrained(__import__("os").environ.get("QWEN_DIR","Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"), device_map="cpu", dtype=getattr(torch, sys.argv[3] if len(sys.argv)>3 else "float32"), low_cpu_mem_usage=True)
print("load", round(time.time()-t0,1), "speakers", m.get_supported_speakers() if hasattr(m,'get_supported_speakers') else '')
for i,t in enumerate(texts,1):
    t1=time.time()
    wavs, sr = m.generate_custom_voice(text=t, language="Korean", speaker=speaker)
    p=f"{out_dir}/qwen3tts-{speaker}-{i}.wav"; sf.write(p, wavs[0], sr)
    print(p, sr, round(time.time()-t1,1), "s")
