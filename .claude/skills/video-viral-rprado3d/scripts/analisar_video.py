#!/usr/bin/env python3
"""Analisa um video de referencia: metadados, cortes de cena e grades de frames.

Uso: python3 analisar_video.py <video.mp4> <pasta_saida> [fps] [limiar_corte]
  fps           frames por segundo extraidos (padrao 2)
  limiar_corte  sensibilidade da deteccao de corte, 0-1 (padrao 0.3)

Gera <pasta_saida>/grade_XX.jpg com 12 frames cada (4 colunas x 3 linhas).
Precisa de ffmpeg e ffprobe no PATH.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

COLS, ROWS = 4, 3


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    video, saida = Path(sys.argv[1]), Path(sys.argv[2])
    fps = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    limiar = float(sys.argv[4]) if len(sys.argv) > 4 else 0.3
    if not video.is_file():
        sys.exit(f"Video nao encontrado: {video}")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} nao encontrado no PATH")
    saida.mkdir(parents=True, exist_ok=True)

    probe = run(["ffprobe", "-v", "error", "-print_format", "json",
                 "-show_format", "-show_streams", str(video)])
    if probe.returncode != 0:
        sys.exit(f"ffprobe falhou: {probe.stderr.strip()}")
    info = json.loads(probe.stdout)
    duracao = float(info["format"]["duration"])
    vid = next(s for s in info["streams"] if s["codec_type"] == "video")
    tem_audio = any(s["codec_type"] == "audio" for s in info["streams"])
    num, den = vid.get("avg_frame_rate", "0/1").split("/")
    fps_orig = float(num) / float(den) if float(den) else 0

    print(f"Arquivo:   {video.name}")
    print(f"Duracao:   {duracao:.2f} s")
    print(f"Resolucao: {vid['width']}x{vid['height']} "
          f"({'vertical' if vid['height'] > vid['width'] else 'horizontal'})")
    print(f"FPS:       {fps_orig:.2f}")
    print(f"Audio:     {'sim' if tem_audio else 'nao'}")

    # Cortes de cena: o filtro showinfo imprime pts_time dos frames selecionados.
    det = run(["ffmpeg", "-hide_banner", "-i", str(video), "-vf",
               f"select='gt(scene,{limiar})',showinfo", "-an", "-f", "null", "-"])
    cortes = [float(t) for t in re.findall(r"pts_time:([0-9.]+)", det.stderr)]
    marcos = [0.0] + cortes + [duracao]
    print(f"\nCortes de cena ({len(cortes)}):")
    for i in range(len(marcos) - 1):
        print(f"  Cena {i + 1:>2}: {marcos[i]:6.2f}s -> {marcos[i + 1]:6.2f}s "
              f"({marcos[i + 1] - marcos[i]:.2f}s)")
    if cortes:
        print(f"Duracao media por cena: {duracao / (len(cortes) + 1):.2f}s")

    for velho in saida.glob("grade_*.jpg"):
        velho.unlink()
    grade = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
                 "-vf", f"fps={fps},scale=360:-2,tile={COLS}x{ROWS}:padding=4:color=white",
                 "-q:v", "3", str(saida / "grade_%02d.jpg")])
    if grade.returncode != 0:
        sys.exit(f"ffmpeg falhou ao gerar grades: {grade.stderr.strip()}")

    por_grade = COLS * ROWS / fps
    grades = sorted(saida.glob("grade_*.jpg"))
    print(f"\nGrades ({len(grades)}; {COLS * ROWS} frames cada, "
          f"leitura da esquerda p/ direita, de cima p/ baixo, 1 frame a cada {1 / fps:.2f}s):")
    for i, g in enumerate(grades):
        ini = i * por_grade
        print(f"  {g}: {ini:.1f}s -> {min(ini + por_grade, duracao):.1f}s")
    print("\nAbra TODAS as grades antes de descrever o video.")


if __name__ == "__main__":
    main()
