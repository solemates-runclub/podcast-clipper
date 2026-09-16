"""Transcribe a video once per source episode.

Usage: python transcribe.py <input_video> <output_json> <model_name> <language>

Writes segment-level timestamps (reliable) with nested word-level timestamps
(kept for reference; the caption line-splitter uses segment boundaries as the
primary structure since word-level DTW timestamps are individually jittery).
"""
import json
import sys

from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 5:
        print("usage: transcribe.py <input> <output_json> <model> <language>", file=sys.stderr)
        sys.exit(1)

    input_path, output_path, model_name, language = sys.argv[1:5]

    print(f"[transcribe] loading model {model_name} (CPU, int8)", file=sys.stderr)
    model = WhisperModel(model_name, device="cpu", compute_type="int8")

    print(f"[transcribe] transcribing {input_path}", file=sys.stderr)
    segments_iter, info = model.transcribe(
        input_path,
        language=language,
        vad_filter=True,
        word_timestamps=True,
    )

    segments = []
    for seg in segments_iter:
        words = []
        if seg.words:
            for w in seg.words:
                words.append({"word": w.word.strip(), "start": w.start, "end": w.end})
        segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text.strip(),
            "words": words,
        })
        print(f"[transcribe] segment {seg.start:.1f}-{seg.end:.1f}: {seg.text.strip()[:60]}", file=sys.stderr)

    result = {
        "duration": info.duration,
        "language": info.language,
        "segments": segments,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[transcribe] wrote {output_path} ({len(segments)} segments)", file=sys.stderr)


if __name__ == "__main__":
    main()
