(() => {
  const minimumPosterMs = 2_500;

  const initialize = (poster) => {
    if (!(poster instanceof HTMLImageElement) || poster.dataset.heroPosterReady === "true") return;

    const banner = poster.closest(".banner-thumbnail-wrapper");
    const video = banner?.querySelector("[data-hero-video]");
    if (!(banner instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;

    poster.dataset.heroPosterReady = "true";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let posterReadyAt = null;
    let revealScheduled = false;

    const startVideoAndReveal = async () => {
      if (reducedMotion || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        revealScheduled = false;
        if (!reducedMotion) video.addEventListener("canplay", scheduleReveal, { once: true });
        return;
      }

      try {
        video.currentTime = 0;
        await video.play();
        if (!video.paused) poster.classList.add("is-hidden");
      } catch {
        video.pause();
        revealScheduled = false;
      }
    };

    const scheduleReveal = () => {
      if (reducedMotion || revealScheduled || posterReadyAt === null) return;
      revealScheduled = true;
      const remaining = Math.max(0, minimumPosterMs - (performance.now() - posterReadyAt));
      window.setTimeout(() => void startVideoAndReveal(), remaining);
    };

    const showPoster = async () => {
      if (posterReadyAt !== null) return;
      try {
        await poster.decode();
      } catch {
        if (poster.naturalWidth === 0) {
          showVideoWithoutPoster();
          return;
        }
      }

      posterReadyAt = performance.now();
      banner.classList.add("is-poster-ready");
      if (reducedMotion) {
        video.pause();
        return;
      }
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleReveal();
      } else {
        video.addEventListener("loadeddata", scheduleReveal, { once: true });
      }
    };

    const showVideoWithoutPoster = () => {
      banner.classList.add("is-poster-ready");
      poster.classList.add("is-hidden");
      if (reducedMotion) {
        video.pause();
        return;
      }
      const start = () => {
        video.currentTime = 0;
        void video.play().catch(() => video.pause());
      };
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) start();
      else video.addEventListener("loadeddata", start, { once: true });
    };

    if (poster.complete) {
      if (poster.naturalWidth > 0) void showPoster();
      else showVideoWithoutPoster();
    } else {
      poster.addEventListener("load", () => void showPoster(), { once: true });
      poster.addEventListener("error", showVideoWithoutPoster, { once: true });
    }
  };

  document.querySelectorAll("[data-hero-video-poster]").forEach(initialize);
})();
