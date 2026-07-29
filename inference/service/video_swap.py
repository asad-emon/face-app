"""Frame-parallel driver for video swaps.

Swapping a frame is dominated by ONNX Runtime and OpenCV calls, both of which
release the GIL, so worker *threads* genuinely run in parallel here. Threads
also let every worker share one copy of the models - processes would need their
own, and the model set is roughly a gigabyte.

Decoding and encoding stay on the calling thread: neither `cv2.VideoCapture`
nor `cv2.VideoWriter` is thread-safe, and sequential decode is cheap next to a
swap. Only the swap itself fans out.

Output order is preserved. Futures are held in a FIFO queue and written in
submission order, so a frame that finishes early waits its turn.
"""

import os
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

import numpy as np

from .observability import get_logger

logger = get_logger("inference.video_swap")

# Frames held in flight per worker. Enough to keep workers fed while the
# writer drains the head of the queue, low enough that a 1080p job holds
# tens of megabytes of decoded frames rather than the whole video.
INFLIGHT_PER_WORKER = 2

# Auto-sizing cap. Scaling is sub-linear because ONNX Runtime already spreads a
# single inference across every core, so workers compete for the same threads.
# Measured on 12 cores, 640x480, two faces per frame:
#
#   workers   1      2      3      4      6      8
#   speedup   1.00x  1.24x  1.48x  1.60x  1.78x  1.82x
#
# Most of the win is in by 4, and this service also serves image swaps - a
# video job that grabs every core would starve them. Operators with a dedicated
# box can set VIDEO_WORKER_COUNT higher; 6-8 buys another ~10-14% there.
MAX_AUTO_WORKERS = 4


def resolve_worker_count(configured: int, cpu_count: Optional[int] = None) -> int:
    """Worker count to use; `configured` <= 0 means auto."""
    if configured > 0:
        return configured
    cores = cpu_count if cpu_count is not None else (os.cpu_count() or 1)
    return max(1, min(MAX_AUTO_WORKERS, cores // 2))


def swap_video_frames(
    cap,
    writer,
    swap_frame: Callable[[np.ndarray], np.ndarray],
    worker_count: int = 1,
    on_progress: Optional[Callable[[int], None]] = None,
    progress_every: int = 30,
) -> int:
    """Swap every frame of `cap` into `writer`. Returns the frame count.

    `on_progress` is called with the number of frames *written*, not submitted,
    so progress never runs ahead of finished work.
    """
    worker_count = max(1, worker_count)
    if worker_count == 1:
        return _swap_serial(cap, writer, swap_frame, on_progress, progress_every)

    logger.info(
        "video_parallel_start",
        extra={"event": "video_parallel_start", "worker_count": worker_count},
    )

    written = 0
    last_reported = 0
    pending: deque = deque()
    max_inflight = worker_count * INFLIGHT_PER_WORKER

    def drain_one() -> None:
        nonlocal written, last_reported
        writer.write(pending.popleft().result())
        written += 1
        if on_progress and written - last_reported >= progress_every:
            on_progress(written)
            last_reported = written

    with ThreadPoolExecutor(
        max_workers=worker_count, thread_name_prefix="swap"
    ) as pool:
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                pending.append(pool.submit(swap_frame, frame))
                if len(pending) >= max_inflight:
                    drain_one()
            while pending:
                drain_one()
        except BaseException:
            # Drop whatever hasn't started; the pool's shutdown then only has
            # to wait for the handful of frames already in flight.
            for future in pending:
                future.cancel()
            raise

    if on_progress and written != last_reported:
        on_progress(written)
    return written


def _swap_serial(
    cap,
    writer,
    swap_frame: Callable[[np.ndarray], np.ndarray],
    on_progress: Optional[Callable[[int], None]],
    progress_every: int,
) -> int:
    """Single-threaded path, kept free of pool overhead."""
    written = 0
    last_reported = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        writer.write(swap_frame(frame))
        written += 1
        if on_progress and written - last_reported >= progress_every:
            on_progress(written)
            last_reported = written
    if on_progress and written != last_reported:
        on_progress(written)
    return written
