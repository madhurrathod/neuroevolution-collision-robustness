#!/bin/sh
# Runs every training job in results/jobs.txt, as many at once as the computer has cores.
# Each job writes results/<condition>_seed<N>.json and a log in logs/.
cd "$(dirname "$0")"
mkdir -p results logs
N=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
[ "$N" -gt 10 ] && N=10
echo "running the jobs, $N at a time; started $(date)"
xargs -P "$N" -L 1 sh -c 'node experiment.mjs --condition "$0" --seed "$1" --out results > "logs/$0_seed$1.log" 2>&1; tail -n 1 "logs/$0_seed$1.log"' < results/jobs.txt
echo "ALL DONE $(date)" | tee logs/ALL_DONE
