#!/usr/bin/env python3
"""
Uppercase a single word from an argument or stdin.
"""
import sys
from sys import argv


def uppercase(word: str) -> str:
    return word.strip().upper()


def main() -> int:
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print("Usage: scripts/uppercase.py WORD or echo word | scripts/uppercase.py")
        return 0
    if len(argv) > 1:
        input_word = " ".join(argv[1:])
    else:
        input_word = sys.stdin.read()
    if not input_word:
        print("No input provided.", file=sys.stderr)
        return 1
    print(uppercase(input_word))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
