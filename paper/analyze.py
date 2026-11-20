"""Analysis of the collision-training experiment.
Reads results/<cond>_seed<N>.json and results/stress_<cond>_seed<N>.json,
prints the summary statistics and writes summary.json and fig_robustness.pdf/png."""
import json, sys, random, statistics as st
from pathlib import Path
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

R = Path(sys.argv[1])
SEEDS = range(1, 16)
CONDS = ["calm", "shoves"]
SCALES = [1, 1.5, 2, 2.5, 3, 3.5, 4]

train = {c: [json.loads((R / f"{c}_seed{s}.json").read_text()) for s in SEEDS] for c in CONDS}
stress = {c: [json.loads((R / f"stress_{c}_seed{s}.json").read_text()) for s in SEEDS] for c in CONDS}
curves = {c: [[l["passed"] for l in r["levels"]] for r in stress[c]] for c in CONDS}
totals = {c: [sum(x) for x in curves[c]] for c in CONDS}  # robustness score: passes over all 7 levels (max 252)

out = {}
print("== training")
for c in CONDS:
    solved = [r["firstSolvedGen"] for r in train[c] if r["firstSolvedGen"] is not None]
    fails = [r["seed"] for r in train[c] if r["firstSolvedGen"] is None]
    print(f"{c}: solved {len(solved)}/15, failed seeds {fails}, first-solved gen median {st.median(solved)} "
          f"(range {min(solved)}-{max(solved)}), minutes median {st.median(r['trainMinutes'] for r in train[c])}")
    out[f"train_{c}"] = dict(solved=len(solved), failed=fails, gen_median=st.median(solved),
                             gen_min=min(solved), gen_max=max(solved))
    for k in ["calm", "shoved", "hard"]:
        v = [r["passed"][k] for r in train[c]]
        print(f"   held-out {k}: mean {st.mean(v):.1f}/36, median {st.median(v)}, min {min(v)}")
        out[f"heldout_{c}_{k}"] = dict(mean=round(st.mean(v), 1), median=st.median(v), min=min(v))

print("== stress curve (mean ± sd, median, min) out of 36")
rows = []
for i, s in enumerate(SCALES):
    row = {"scale": s}
    for c in CONDS:
        v = [x[i] for x in curves[c]]
        row[c] = dict(mean=round(st.mean(v), 1), sd=round(st.stdev(v), 1), median=st.median(v), min=min(v))
    rows.append(row)
    print(f"{s}x  calm {row['calm']['mean']:5.1f}±{row['calm']['sd']:4.1f} med {row['calm']['median']:4} min {row['calm']['min']:2}"
          f" | shoves {row['shoves']['mean']:5.1f}±{row['shoves']['sd']:4.1f} med {row['shoves']['median']:4} min {row['shoves']['min']:2}")
out["curve"] = rows

def report(label, a, b):
    """a = calm totals, b = shoves totals"""
    diff = st.mean(b) - st.mean(a)
    u = stats.mannwhitneyu(b, a, alternative="two-sided")
    rng = random.Random(12345); pooled = a + b; n = len(a); hits = 0; N = 100000
    for _ in range(N):
        rng.shuffle(pooled)
        if abs(st.mean(pooled[n:]) - st.mean(pooled[:n])) >= abs(diff) - 1e-9: hits += 1
    boots = []
    for _ in range(10000):
        ra = [rng.choice(a) for _ in a]; rb = [rng.choice(b) for _ in b]
        boots.append(st.mean(rb) - st.mean(ra))
    boots.sort()
    sp = ((st.variance(a) + st.variance(b)) / 2) ** 0.5
    lev = stats.levene(a, b, center="median")
    r = dict(n_calm=len(a), n_shoves=len(b), mean_calm=round(st.mean(a), 1), mean_shoves=round(st.mean(b), 1),
             median_calm=st.median(a), median_shoves=st.median(b), sd_calm=round(st.stdev(a), 1), sd_shoves=round(st.stdev(b), 1),
             min_calm=min(a), min_shoves=min(b), diff=round(diff, 1), ci95=[round(boots[249], 1), round(boots[9749], 1)],
             perm_p=round(hits / N, 4), mwu_p=round(u.pvalue, 4), cohen_d=round(diff / sp, 2), levene_p=round(lev.pvalue, 4))
    print(f"== {label}: {r}")
    return r

print("== robustness score per network (sum over 7 levels, max 252)")
for c in CONDS: print(c, totals[c])
out["totals"] = totals
out["all15"] = report("all 15 seeds", totals["calm"], totals["shoves"])
# sensitivity: drop networks that never solved training (calm seed 15)
ok = {c: [t for t, r in zip(totals[c], train[c]) if r["firstSolvedGen"] is not None] for c in CONDS}
out["trained_only"] = report("excluding training failures", ok["calm"], ok["shoves"])
out["pilot5"] = report("pilot seeds 1-5", totals["calm"][:5], totals["shoves"][:5])

print("== why drives failed (all levels, all networks)")
for c in CONDS:
    why = {}
    for r, t in zip(stress[c], train[c]):
        if t["firstSolvedGen"] is None: continue
        for l in r["levels"]:
            for d in l["drives"]:
                if not d["passed"]: why[d["why"]] = why.get(d["why"], 0) + 1
    print(c, why); out[f"why_{c}"] = why

(R.parent / "summary.json").write_text(json.dumps(out, indent=1))

# ---- figure: robustness curves (median and interquartile range, thin lines = individual networks)
plt.rcParams.update({"font.size": 9, "font.family": "serif"})
fig, ax = plt.subplots(figsize=(5.2, 3.2))
colors = {"calm": "#c0504d", "shoves": "#2f6db3"}
labels = {"calm": "Trained calm (no collisions)", "shoves": "Trained with simulated collisions"}
for c in CONDS:
    for x in curves[c]: ax.plot(SCALES, [v / 36 * 100 for v in x], color=colors[c], alpha=0.13, lw=0.8)
    q = [[sorted(x[i] for x in curves[c])[k] / 36 * 100 for i in range(len(SCALES))] for k in (3, 7, 11)]
    ax.fill_between(SCALES, q[0], q[2], color=colors[c], alpha=0.18, lw=0)
    ax.plot(SCALES, q[1], color=colors[c], lw=2.2, marker="o", ms=3.5, label=labels[c])
ax.set_xlabel("Collision strength (multiple of the standard held-out shove)")
ax.set_ylabel("Held-out drives passed (%)")
ax.set_ylim(-3, 103); ax.set_xticks(SCALES)
ax.grid(alpha=0.25, lw=0.5); ax.spines[["top", "right"]].set_visible(False)
ax.legend(frameon=False, loc="lower left")
fig.tight_layout()
for ext in ("pdf", "png"): fig.savefig(R.parent / f"fig_robustness.{ext}", dpi=200)
print("figure written")
