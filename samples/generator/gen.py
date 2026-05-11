#!/usr/bin/env python3
"""Synthetic corpus generator for AURO-DLP evaluation."""

import os
import random
import string
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "corpus"

def verhoeff_checksum(num_str):
    d = [
        [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
        [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
        [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
        [9,8,7,6,5,4,3,2,1,0]
    ]
    p = [
        [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
        [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
        [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
    ]
    inv = [0,4,3,2,1,5,6,7,8,9]
    c = 0
    digits = [int(x) for x in reversed(num_str)]
    for i, digit in enumerate(digits):
        c = d[c][p[(i+1) % 8][digit]]
    return inv[c]

def gen_aadhaar():
    base = str(random.randint(2, 9))
    for _ in range(10):
        base += str(random.randint(0, 9))
    check = verhoeff_checksum(base)
    return base + str(check)

def gen_pan():
    letters = string.ascii_uppercase
    pan = ''.join(random.choices(letters, k=3))
    pan += random.choice("PCHABGJLFT")
    pan += random.choice(letters)
    pan += ''.join([str(random.randint(0, 9)) for _ in range(4)])
    pan += random.choice(letters)
    return pan

def luhn_checksum(num_str):
    digits = [int(x) for x in num_str]
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    total = sum(odd_digits)
    for d in even_digits:
        total += sum(divmod(d * 2, 10))
    return total % 10

def gen_ccn():
    prefix = random.choice(["4", "51", "52", "53", "54", "55"])
    num = prefix
    while len(num) < 15:
        num += str(random.randint(0, 9))
    for check in range(10):
        candidate = num + str(check)
        if luhn_checksum(candidate) == 0:
            return candidate
    return num + "0"

def gen_ssn():
    area = random.randint(1, 899)
    if area == 666: area = 667
    group = random.randint(1, 99)
    serial = random.randint(1, 9999)
    return f"{area:03d}-{group:02d}-{serial:04d}"

def gen_mrn():
    return f"MRN-{random.randint(100000, 999999)}"

def gen_abha():
    return f"{random.randint(10,99)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}"

def gen_mobile_in():
    return f"+91 {random.choice(['7','8','9'])}{random.randint(100000000, 999999999)}"

TEMPLATES = {
    "aadhaar": {
        "expected_verdict": "BLOCK",
        "expected_rules": ["IN.AADHAAR"],
        "gen": lambda: f"Patient Aadhaar for identity verification: {gen_aadhaar()}. Please process discharge.",
    },
    "pan": {
        "expected_verdict": "BLOCK",
        "expected_rules": ["IN.PAN"],
        "gen": lambda: f"Insurance claim reference PAN: {gen_pan()}. Billing dept to follow up.",
    },
    "ccn": {
        "expected_verdict": "BLOCK",
        "expected_rules": ["CCN"],
        "gen": lambda: f"Patient payment card on file: {gen_ccn()}. Do not share externally.",
    },
    "ssn": {
        "expected_verdict": "BLOCK",
        "expected_rules": ["US.SSN"],
        "gen": lambda: f"NRI patient SSN for US insurance: {gen_ssn()}. Forward to billing.",
    },
    "mrn": {
        "expected_verdict": "BLOCK",
        "expected_rules": ["PHI.MRN"],
        "gen": lambda: f"Discharge summary for {gen_mrn()}, Dr. Sharma ward 4B. Follow up in 2 weeks.",
    },
    "abha": {
        "expected_verdict": "BLOCK",
        "expected_rules": ["IN.ABHA"],
        "gen": lambda: f"ABHA Health ID: {gen_abha()}. Link to patient EMR before transfer.",
    },
    "mobile_in": {
        "expected_verdict": "WARN",
        "expected_rules": ["IN.MOBILE"],
        "gen": lambda: f"Contact patient at {gen_mobile_in()} for lab results. Ask for {random.choice(['Rajesh','Priya','Amit','Sunita'])}.",
    },
    "clinical_narrative": {
        "expected_verdict": "WARN",
        "expected_rules": ["PHI.CLINICAL"],
        "gen": lambda: f"Pt presents with {random.choice(['chest pain','SOB','fever x 3 days','abdominal distension'])}. "
                       f"Hx of {random.choice(['DM2','HTN','COPD','CKD stage 3'])}. "
                       f"Plan: {random.choice(['admit to ICU','start IV antibiotics','schedule echo','CT abdomen'])}.",
    },
    "hindi_mixed": {
        "expected_verdict": "WARN",
        "expected_rules": ["IN.AADHAAR", "PHI.CLINICAL"],
        "gen": lambda: f"रोगी का आधार: {gen_aadhaar()}. निदान: {random.choice(['मधुमेह','उच्च रक्तचाप','हृदय रोग'])}. "
                       f"दवाई: {random.choice(['Metformin 500mg','Amlodipine 5mg','Atorvastatin 10mg'])}.",
    },
    "clean_business": {
        "expected_verdict": "ALLOW",
        "expected_rules": [],
        "gen": lambda: f"Hi team, the vendor meeting is scheduled for {random.choice(['Monday','Tuesday','Wednesday'])} "
                       f"at {random.randint(9,17)}:00. Please confirm attendance. Regards, {random.choice(['Admin','Procurement','IT'])} dept.",
    },
    "clean_personal": {
        "expected_verdict": "ALLOW",
        "expected_rules": [],
        "gen": lambda: f"Hey, are we still on for {random.choice(['lunch','coffee','the movie'])} "
                       f"{random.choice(['tomorrow','this weekend','on Friday'])}? Let me know!",
    },
}

COUNTS = {
    "aadhaar": 30, "pan": 20, "ccn": 15, "ssn": 10, "mrn": 25,
    "abha": 10, "mobile_in": 15, "clinical_narrative": 20,
    "hindi_mixed": 20, "clean_business": 30, "clean_personal": 20,
}

def write_sample(category, index, content, verdict, rules):
    outdir = OUTPUT_DIR / category
    outdir.mkdir(parents=True, exist_ok=True)
    fname = outdir / f"{category}_{index:03d}.md"
    rules_str = "[" + ", ".join(f'"{r}"' for r in rules) + "]"
    with open(fname, "w") as f:
        f.write(f"---\nexpected_verdict: {verdict}\nexpected_rules: {rules_str}\n---\n{content}\n")

def main():
    random.seed(42)
    total = 0
    for cat, count in COUNTS.items():
        tmpl = TEMPLATES[cat]
        for i in range(1, count + 1):
            content = tmpl["gen"]()
            write_sample(cat, i, content, tmpl["expected_verdict"], tmpl["expected_rules"])
            total += 1
    print(f"Generated {total} corpus files in {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
