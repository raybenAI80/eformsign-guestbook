#!/usr/bin/env bash
# usage: measure.sh file.wav ... -> markdown rows (silencedetect -40dB d=0.15, volumedetect)
for f in "$@"; do
  info=$(ffprobe -v error -show_entries stream=sample_rate,channels:format=duration -of default=nw=1 "$f")
  sr=$(grep sample_rate <<<"$info" | cut -d= -f2); ch=$(grep channels <<<"$info" | cut -d= -f2); dur=$(grep duration <<<"$info" | cut -d= -f2)
  sil=$(ffmpeg -hide_banner -nostats -i "$f" -af silencedetect=noise=-40dB:d=0.15 -f null - 2>&1 | grep -o "silence_duration: [0-9.]*" | awk '{s+=$2} END{printf "%.3f", s+0}')
  vol=$(ffmpeg -hide_banner -nostats -i "$f" -af volumedetect -f null - 2>&1)
  mean=$(grep -o "mean_volume: [-0-9.]*" <<<"$vol" | awk '{print $2}'); max=$(grep -o "max_volume: [-0-9.]*" <<<"$vol" | awk '{print $2}')
  [ "$ch" = 1 ] && chs=mono || chs="${ch}ch"
  pct=$(awk -v a="$sil" -v b="$dur" 'BEGIN{printf "%d%%", a/b*100+0.5}')
  printf "| %s | %s · %s | %.3f | %s | %s | %s / %s |\n" "$(basename "$f")" "$sr" "$chs" "$dur" "$sil" "$pct" "$mean" "$max"
done
