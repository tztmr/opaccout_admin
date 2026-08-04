package com.tencent.mobileqq;

/** Monotonically invalidates callbacks from earlier short-OP submissions. */
final class ShortOpRequestGate {
    private int generation;
    private boolean destroyed;

    synchronized int begin() {
        if (destroyed) return -1;
        generation += 1;
        return generation;
    }

    synchronized void cancel() {
        generation += 1;
    }

    synchronized void destroy() {
        destroyed = true;
        generation += 1;
    }

    synchronized boolean isCurrent(int candidate) {
        return !destroyed && candidate == generation;
    }
}
