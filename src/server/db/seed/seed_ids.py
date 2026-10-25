#!/usr/bin/env python3
"""Deterministic seed ids (Architect decision 0009-b): UUID v5 of '<kind>:<natural key>' in the DOOYOOSH seed namespace.
   NAMESPACE = uuid5(NAMESPACE_URL, 'https://dooyoosh.uz/seed')
   Prints the SQL values rows used by reference.sql / demo.sql. Re-run only to add keys; existing ids never change.
   Usage: python3 seed_ids.py            -> all '(key, id)' rows
          python3 seed_ids.py variant:DEMO-01-S-IVO -> one id"""
import sys, uuid

NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://dooyoosh.uz/seed")
def sid(key: str) -> str: return str(uuid.uuid5(NS, key))

PRODUCTS = [  # (slug, category, size_system)
    ("demo-linen-wrap-dress", "clothing", "alpha"), ("demo-silk-slip-skirt", "clothing", "alpha"),
    ("demo-merino-cardigan", "clothing", "alpha"), ("demo-wool-coat", "clothing", "alpha"),
    ("demo-cotton-shirt", "clothing", "alpha"), ("demo-leather-loafer", "footwear", "eu_shoe"),
    ("demo-suede-ankle-boot", "footwear", "eu_shoe"), ("demo-canvas-sneaker", "footwear", "eu_shoe"),
    ("demo-mini-tote", "accessories", "one_size"), ("demo-silk-scarf", "accessories", "one_size"),
    ("demo-leather-belt", "accessories", "one_size"), ("demo-card-holder", "accessories", "one_size"),
]
SIZES = {"alpha": [("XS", "Ivory"), ("S", "Ivory"), ("M", "Ivory"), ("L", "Ivory")],
         "eu_shoe": [("37", "Espresso"), ("38", "Espresso"), ("39", "Espresso"), ("40", "Espresso")],
         "one_size": [(None, "Dusty Rose"), (None, "Espresso")]}
ARTICLES = ["demo-spring-edit", "demo-how-to-style-silk", "demo-inside-the-atelier", "demo-autumn-preview"]
TAGS = ["demo-editorial", "demo-styling", "demo-atelier"]

def keys():
    yield "market:UZ"
    for c in ("clothing", "footwear", "accessories"): yield f"category:{c}"
    yield "shipping_method:UZ:placeholder-standard"
    yield "shipping_rate:placeholder-standard:0"
    for i, (slug, _, sys_) in enumerate(PRODUCTS, 1):
        yield f"product:{slug}"
        for n in (1, 2): yield f"product_image:demo/{slug}/{n}.jpg"
        for size, colour in SIZES[sys_]:
            yield f"variant:DEMO-{i:02d}-{size or 'OS'}-{colour.replace(' ', '')[:3].upper()}"
    for t in TAGS: yield f"tag:{t}"
    for a in ARTICLES: yield f"article:{a}"

if __name__ == "__main__":
    if len(sys.argv) > 1: print(sid(sys.argv[1]))
    else: print(",\n".join(f"  ('{k}', '{sid(k)}'::uuid)" for k in keys()))
