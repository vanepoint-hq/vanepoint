# Research paper

**Vanepoint: A Low-Latency, Haptic, Multi-Modal Smartphone Input System for Laptops** (preprint v0.1)

| File | Description |
| --- | --- |
| [`Vanepoint-Paper.pdf`](Vanepoint-Paper.pdf) | Two-column paper (10 pages) |
| [`Vanepoint-Paper.docx`](Vanepoint-Paper.docx) | Editable Word version |
| [`figures/make_figures.py`](figures/make_figures.py) | Regenerates every figure, equation image and simulation result |
| [`figures/metrics.json`](figures/metrics.json) | Simulation outputs quoted in the paper |

## Reproducing the figures

```bash
pip install numpy matplotlib
python docs/paper/figures/make_figures.py
```

The script prints the 1€ filter, inertia, and latency-budget numbers used in Sections V, VI and X.

## Status

This version reports the design, an analytical latency model, simulations, and a **pre-registered** evaluation protocol (Section XI). It contains no user-study or hardware measurements yet. Results will be added in a later revision and tagged in this repository.

## Citing

Use the **Cite this repository** button on GitHub (generated from [`CITATION.cff`](../../CITATION.cff)).
