(() => {
  const minimumPosterMs = 2_500;

  const initialize = (poster) => {
    if (!(poster instanceof HTMLImageElement) || poster.dataset.heroPosterReady === "true") return;

    const banner = poster.closest(".banner-thumbnail-wrapper");
    const video = banner?.querySelector("[data-hero-video]");
    if (!(banner instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;

    poster.dataset.heroPosterReady = "true";
    let posterReadyAt = null;
    let revealScheduled = false;

    const scheduleReveal = () => {
      if (revealScheduled || posterReadyAt === null) return;
      revealScheduled = true;
      const remaining = Math.max(0, minimumPosterMs - (performance.now() - posterReadyAt));
      window.setTimeout(() => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          revealScheduled = false;
          video.addEventListener("canplay", scheduleReveal, { once: true });
          return;
        }
        poster.classList.add("is-hidden");
      }, remaining);
    };

    const showPoster = () => {
      if (posterReadyAt !== null) return;
      posterReadyAt = performance.now();
      banner.classList.add("is-poster-ready");
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleReveal();
      } else {
        video.addEventListener("loadeddata", scheduleReveal, { once: true });
      }
    };

    const showVideoWithoutPoster = () => {
      banner.classList.add("is-poster-ready");
      poster.classList.add("is-hidden");
    };

    if (poster.complete) {
      if (poster.naturalWidth > 0) showPoster();
      else showVideoWithoutPoster();
    } else {
      poster.addEventListener("load", showPoster, { once: true });
      poster.addEventListener("error", showVideoWithoutPoster, { once: true });
    }
  };

  document.querySelectorAll("[data-hero-video-poster]").forEach(initialize);
})();
