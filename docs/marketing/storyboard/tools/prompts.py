# Prompt source for storyboard frames. Run: python tools/prompts.py -> writes manifest-anchor.json & manifest-rest.json
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STYLE = ("Film pre-production storyboard panel, 16:9 landscape, single scene in one frame. "
         "Hand-drawn pencil line art with soft grey marker shading on off-white paper, loose but clean, "
         "thin dark pencil frame border around the panel. Monochrome greys only, with exactly ONE accent color: "
         "a clear medium blue (#1E6FD9) used sparingly on the key element. ")
NOTEXT = ("Absolutely no readable text, letters, numbers, words, Korean or Latin characters, logos or brand marks anywhere in the image; "
          "every on-screen label, heading or caption is drawn only as empty rectangles or simple horizontal grey lines. "
          "No faces in close-up; people appear only as a hand, forearm or shoulder. Neutral plain office-lobby background at most, "
          "no event booths, banners, exhibition stands or signage. ")
TABLET = ("The tablet screen shows a visitor log form web page in portrait orientation: a white header band at the top "
          "(a short line block on the left, a centered title line with a thinner subtitle line under it, and on the right "
          "a small rounded button outlined in blue), below it a table form with a dark navy header strip and ten ruled rows, "
          "each row with columns for name, phone, a few small checkbox squares for visit purpose, and a wide signature box. ")
SHOTS = [
 ("01-hook", "Shot: pure black background. A portrait tablet floats up out of the darkness in the center, slightly tilted, "
   "its screen glowing softly as it fades in; the white header band at the top of the screen is the sharpest, most readable part, "
   "the blue outlined button on its right is the only blue. Lower half of the screen still fading into shadow. Upward motion arrow drawn faintly beside the tablet. " + TABLET),
 ("02-arrive", "Shot: the whole portrait tablet standing on a plain lobby counter, seen straight on. Only the first row of the form is bright and highlighted "
   "with a blue outline; all other nine rows are empty and dimmed grey. A single index finger of a hand enters from the lower right and is about to touch "
   "the name cell of the highlighted row; small tap-ripple marks near the fingertip. " + TABLET),
 ("03-fill", "Shot: three-step sequence in one panel, divided into three equal vertical sub-frames with thin pencil dividers and small arrows between them. "
   "Left sub-frame: close-up of the highlighted form row, finger typing into the name and phone cells (cells drawn with grey scribble lines, not letters). "
   "Middle sub-frame: finger ticking one small checkbox square with a blue check mark. "
   "Right sub-frame: fingertip drawing a looping signature stroke inside the wide signature box, and at the bottom of the screen a glowing blue guidance bar "
   "lit up with a rounded send button on it. Same tablet form design in all three. " + TABLET),
 ("04-next", "Shot: split screen, left and right halves divided by a vertical pencil line, the same portrait tablet form on each side. "
   "Left half: the first row is filled in with grey handwriting-like scribbles and a signature squiggle. "
   "Right half: the second visitor's view of the same page; the first row is now covered by a solid flat grey mask bar so its content is hidden, "
   "and the second row is bright with a blue outline, ready for input. A small curved return arrow above the right tablet suggests the page reset itself. " + TABLET),
 ("05-stack", "Shot: a desktop PC monitor on a desk, three-quarter view. The monitor shows a document management web app: a left sidebar of grey bars, "
   "and a document list table of several rows where exactly one row is highlighted in blue. Next to the monitor, floating slightly in front, "
   "a large preview sheet of a single portrait form page whose ten rows are all filled with grey scribbles and signatures, "
   "with a thin blue connector line from the highlighted list row to the preview sheet. No text, only bars and lines."),
 ("06-manage", "Shot: a left-to-right flow of three panels-within-the-panel connected by bold blue arrows, all on a PC screen style frame. "
   "First: a search box (empty rounded rectangle with a magnifier icon) with a cursor. Second: a document preview window showing one portrait form page with ruled filled rows. "
   "Third: a large download icon (downward arrow into a tray) in blue. Clean diagrammatic storyboard sketch, no text, only shapes and lines."),
 ("07-branch", "Shot: a single portrait visitor-log form sheet in the center-left (navy header strip, ten ruled rows) from which three other paper documents "
   "fan out and split away to the right along curved motion lines: a contract-like sheet with paragraph lines and a signature line, "
   "a consent-form-like sheet with paragraph lines and checkbox squares, and a receipt-like narrow slip with lines. "
   "The motion lines and one small corner tab on each new sheet are blue. Dynamic transition feeling, paper sheets in perspective, no text."),
 ("08-cta", "Shot: end card. Centered on the panel, an empty rounded rectangle placeholder box drawn in pencil marking where a logo will go (leave it blank inside), "
   "and directly under it one short horizontal grey line marking where a web address will go. Behind them a large softly tilted blue panel "
   "(a rotated rounded rectangle, about 6 degrees) filling the middle of the frame, light grey paper around it. Calm, minimal, lots of empty space."),
]
def job(i, sid, shot, ref=None):
    j = {"id": sid, "prompt": STYLE + shot + " " + NOTEXT, "out": os.path.join(ROOT, "frames", sid + ".png").replace("\\", "/")}
    if ref:
        j["references"] = [ref]
    return j
if __name__ == "__main__":
    anchor = os.path.join(ROOT, "frames", "01-hook.png").replace("\\", "/")
    json.dump({"version": 1, "jobs": [job(0, *SHOTS[0])]}, open(os.path.join(HERE, "manifest-anchor.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    rest = [job(i, sid, s, anchor) for i, (sid, s) in enumerate(SHOTS) if i > 0]
    for j in rest:
        j["prompt"] = "Match exactly the drawing style, paper, line weight, grey marker shading and blue accent of the attached reference storyboard panel (style reference only, not its content). " + j["prompt"]
    json.dump({"version": 1, "jobs": rest}, open(os.path.join(HERE, "manifest-rest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("ok", len(rest) + 1)
