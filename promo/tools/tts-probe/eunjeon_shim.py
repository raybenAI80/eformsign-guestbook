# shim: g2pkk on Windows imports eunjeon; route to python-mecab-ko installed in a separate dir
# (python-mecab-ko's "mecab" dir collides with mecab-python3's "MeCab" on case-insensitive NTFS)
import os, sys
_lib = os.environ.get("MELO_KOLIB")
if _lib and _lib not in sys.path:
    sys.path.append(_lib)
from mecab import MeCab as Mecab
