#!/usr/bin/env python3
"""Confere o tamanho de um prompt com codigo (nunca no olho).

Uso: python3 checar_prompt.py <arquivo.txt> [limite]   (limite padrao 500)
Sai com codigo 1 se passar do limite.
"""
import sys
from pathlib import Path

if len(sys.argv) < 2:
    sys.exit(__doc__)
texto = Path(sys.argv[1]).read_text(encoding="utf-8").strip()
limite = int(sys.argv[2]) if len(sys.argv) > 2 else 500
n = len(texto)
if n > limite:
    print(f"ACIMA DO LIMITE: {n}/{limite} caracteres (cortar {n - limite}). "
          "Corte descricao visual, nunca a fala.")
    sys.exit(1)
print(f"OK: {n}/{limite} caracteres")
