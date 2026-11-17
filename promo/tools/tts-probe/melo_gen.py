import sys, time, torch
torch.set_num_threads(16)
from melo.api import TTS
out_dir = sys.argv[1]; speed=float(sys.argv[2]) if len(sys.argv)>2 else 1.0
texts = ["방명록, 아직도 수기로 작성하고 직접 관리하시나요?",
         "열 분이 써도 문서는 한 장입니다. 다음 날 담당자 문서함에는 그 한 장만 있습니다."]
t0=time.time(); m = TTS(language='KR', device='cpu'); print("load", round(time.time()-t0,1), m.hps.data.spk2id, flush=True)
for i,t in enumerate(texts,1):
    t1=time.time(); p=f"{out_dir}/melotts-KR-{i}.wav"
    m.tts_to_file(t, m.hps.data.spk2id['KR'], p, speed=speed); print(p, round(time.time()-t1,1), "s", flush=True)
