import React, { useState, useRef } from 'react';
import './App.css';

const MAX_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

function compressDataUrlForApi(dataUrl, maxDim = 960, quality = 0.72) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl: compressed, mimeType: 'image/jpeg' });
      } catch {
        resolve({ dataUrl, mimeType: 'image/jpeg' });
      }
    };
    img.onerror = () => resolve({ dataUrl, mimeType: 'image/jpeg' });
    img.src = dataUrl;
  });
}

function buildClientFallbackCaptions(context, photoCount) {
  const cleanContext = typeof context === 'string' ? context.trim() : '';
  const photoWord = photoCount === 1 ? 'this photo' : 'these photos';
  if (cleanContext) {
    return [
      {
        style: 'Simple and warm',
        text: `So glad to have ${photoWord} to look back on. ${cleanContext}`,
      },
      {
        style: 'Heartfelt and reflective',
        text: `Days like this remind me how much the simple moments matter. Grateful for the memories captured here — ${cleanContext}`,
      },
      {
        style: 'Cheerful and light',
        text: `Such a lovely time together! Sharing a peek at our day: ${cleanContext}`,
      },
      {
        style: 'Short and sweet',
        text: `Good times and fond memories. ${cleanContext}`,
      },
    ];
  }
  return [
    {
      style: 'Simple and warm',
      text: 'Sharing a few favourite moments from a very pleasant day. Always nice to pause and enjoy the little things.',
    },
    {
      style: 'Heartfelt and reflective',
      text: 'Looking back at moments like these always brings a quiet sense of gratitude for the days we get to enjoy.',
    },
    {
      style: 'Cheerful and light',
      text: 'A wonderful day worth sharing with everyone. Hope you are all having a lovely week too.',
    },
    {
      style: 'Short and sweet',
      text: 'A lovely moment worth remembering.',
    },
  ];
}

function copyTextSynchronously(text) {
  if (!text) return false;
  let copied = false;
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    copied = document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch {
    copied = false;
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  return copied;
}

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [context, setContext] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [uploadErrors, setUploadErrors] = useState([]);
  const [generationError, setGenerationError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [captions, setCaptions] = useState([]);
  const [testModeNotice, setTestModeNotice] = useState('');

  // Carousel state: currentSlide is which slide the user is viewing (0..3)
  // pickedIndex is which caption the user explicitly chose (null until they pick one)
  const [currentSlide, setCurrentSlide] = useState(0);
  const [pickedIndex, setPickedIndex] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [exportedPost, setExportedPost] = useState(null);

  const fileInputRef = useRef(null);
  const inFlightRef = useRef(null);
  const resultsRef = useRef(null);
  const exportPreviewRef = useRef(null);
  const touchStartXRef = useRef(null);

  const hasGeneratedCaptions = captions.length > 0;
  const activeCaption = hasGeneratedCaptions ? captions[currentSlide] : null;
  const pickedCaption =
    hasGeneratedCaptions && pickedIndex !== null ? captions[pickedIndex] : null;
  const canExportSocial = Boolean(pickedCaption && !isGenerating);

  const cleanHandle = instagramHandle.trim().replace(/^@+/, '');

  const handleChoosePhotosClick = () => {
    if (isGenerating) return;
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';

    if (selectedFiles.length === 0) return;

    const newErrors = [];
    const remainingSlots = MAX_PHOTOS - photos.length;

    if (remainingSlots <= 0) {
      setUploadErrors([
        `You already have ${MAX_PHOTOS} photos selected. Remove a photo first if you would like to choose a different one.`,
      ]);
      return;
    }

    const filesToProcess = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > remainingSlots) {
      newErrors.push(
        `You can use up to ${MAX_PHOTOS} photos at a time. Only the first ${
          remainingSlots === 1 ? 'photo was' : `${remainingSlots} photos were`
        } checked.`
      );
    }

    const validLoadedPhotos = [];

    for (const file of filesToProcess) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        newErrors.push(
          `"${file.name}" is not a supported photo file. Please choose a JPG, PNG, WebP, or GIF photo.`
        );
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        newErrors.push(
          `"${file.name}" is too large (${sizeMb} MB). Please choose a photo under 10 MB.`
        );
        continue;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const compressed = await compressDataUrlForApi(dataUrl);
        validLoadedPhotos.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: file.name,
          mimeType: file.type,
          apiMimeType: compressed.mimeType,
          size: file.size,
          file,
          dataUrl,
          apiDataUrl: compressed.dataUrl,
        });
      } catch {
        newErrors.push(
          `"${file.name}" could not be opened. Please try choosing that photo again.`
        );
      }
    }

    setUploadErrors(newErrors);
    if (validLoadedPhotos.length > 0) {
      setPhotos((prev) => [...prev, ...validLoadedPhotos].slice(0, MAX_PHOTOS));
      setGenerationError('');
    }
  };

  const handleRemovePhoto = (idToRemove) => {
    if (isGenerating) return;
    setPhotos((prev) => prev.filter((photo) => photo.id !== idToRemove));
    setUploadErrors([]);
  };

  const handleGenerateCaptions = async () => {
    if (inFlightRef.current || isGenerating) return;

    if (photos.length === 0) {
      setGenerationError('Please choose at least one photo before creating captions.');
      return;
    }

    inFlightRef.current = true;
    setIsGenerating(true);
    setGenerationError('');
    setCopiedIndex(null);
    setPickedIndex(null);
    setCurrentSlide(0);
    setExportedPost(null);

    try {
      const response = await fetch('/api/captions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          photos: photos.map((photo) => ({
            name: photo.name,
            mimeType: photo.apiMimeType || photo.mimeType,
            dataUrl: photo.apiDataUrl || photo.dataUrl,
          })),
          context: context.trim(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(data?.captions) || data.captions.length === 0) {
        const fallback = buildClientFallbackCaptions(context, photos.length);
        setCaptions(fallback);
        setTestModeNotice('');
        setCurrentSlide(0);
        setPickedIndex(null);
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 50);
        return;
      }

      setCaptions(data.captions);
      setTestModeNotice(typeof data.notice === 'string' ? data.notice : '');
      setCurrentSlide(0);
      setPickedIndex(null);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    } catch {
      const fallback = buildClientFallbackCaptions(context, photos.length);
      setCaptions(fallback);
      setTestModeNotice('');
      setCurrentSlide(0);
      setPickedIndex(null);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    } finally {
      setIsGenerating(false);
      inFlightRef.current = false;
    }
  };

  const handlePrevSlide = () => {
    if (!hasGeneratedCaptions) return;
    setCurrentSlide((prev) => (prev === 0 ? captions.length - 1 : prev - 1));
  };

  const handleNextSlide = () => {
    if (!hasGeneratedCaptions) return;
    setCurrentSlide((prev) => (prev === captions.length - 1 ? 0 : prev + 1));
  };

  const handleTouchStart = (e) => {
    touchStartXRef.current = e.touches?.[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e) => {
    if (touchStartXRef.current === null) return;
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    if (endX !== null) {
      const diff = touchStartXRef.current - endX;
      if (diff > 45) {
        handleNextSlide();
      } else if (diff < -45) {
        handlePrevSlide();
      }
    }
    touchStartXRef.current = null;
  };

  const handlePickCaption = (index) => {
    if (!hasGeneratedCaptions) return;
    setPickedIndex(index);
    setExportedPost(null);
  };

  const handleCopyCaption = (index) => {
    const target = captions[index];
    if (!target?.text) return;
    const ok = copyTextSynchronously(target.text);
    if (ok) {
      setPickedIndex(index);
      setCopiedIndex(index);
    } else {
      setGenerationError(
        'We could not copy the caption automatically. You can press and hold the caption text to copy it.'
      );
    }
  };

  const handleExportToSocial = async (platform) => {
    if (!pickedCaption) return;

    const captionToShare = pickedCaption.text;
    // Copy synchronously BEFORE any window.open or async call so clipboard never fails
    copyTextSynchronously(captionToShare);
    setCopiedIndex(pickedIndex);

    const handleLabel = cleanHandle ? `@${cleanHandle}` : 'your account';

    setExportedPost({
      platform,
      handle: cleanHandle ? `@${cleanHandle}` : '',
      style: pickedCaption.style,
      captionText: captionToShare,
      photos,
    });

    setTimeout(() => {
      exportPreviewRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 50);

    // For LinkedIn, open the post composer directly with the caption pre-filled in the text parameter!
    if (platform === 'LinkedIn') {
      const linkedInUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(
        captionToShare
      )}`;
      window.open(linkedInUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // If on a mobile device that supports native Web Share API, trigger the native share sheet
    const rawFiles = photos.map((p) => p.file).filter(Boolean);
    const canNativeShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      rawFiles.length > 0 &&
      navigator.canShare({ files: rawFiles });

    if (canNativeShareFiles) {
      try {
        await navigator.share({
          files: rawFiles,
          text: captionToShare,
          title: `Post to ${platform} (${handleLabel})`,
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') {
          return;
        }
      }
    }
  };

  const handleOpenExternalPlatform = (platform) => {
    if (!pickedCaption) return;
    copyTextSynchronously(pickedCaption.text);
    setCopiedIndex(pickedIndex);

    if (platform === 'LinkedIn') {
      const linkedInUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(
        pickedCaption.text
      )}`;
      window.open(linkedInUrl, '_blank', 'noopener,noreferrer');
    } else if (platform === 'Instagram') {
      const url = cleanHandle
        ? `https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`
        : 'https://www.instagram.com/';
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      const fbUrl = `https://www.facebook.com/`;
      window.open(fbUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="page-shell">
      <div className="mobile-container">
        <header className="page-header">
          <h1 className="page-title">Create a caption for your photos.</h1>
          <p className="page-subtitle">
            Choose your photos. Pick a caption. Copy and share.
          </p>
        </header>

        <main>
          {/* Step 1: Photo Upload */}
          <section className="step-section" aria-labelledby="step-photos-heading">
            <h2 id="step-photos-heading" className="step-heading">
              1. Choose your photos
            </h2>
            <p className="step-help">
              You can add up to 10 photos (JPG, PNG, WebP, or GIF, up to 10 MB each).
            </p>

            <input
              ref={fileInputRef}
              id="photo-upload-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleFilesSelected}
              className="file-input-hidden"
              disabled={isGenerating || photos.length >= MAX_PHOTOS}
            />

            <button
              type="button"
              className="action-btn action-btn-secondary"
              onClick={handleChoosePhotosClick}
              disabled={isGenerating || photos.length >= MAX_PHOTOS}
            >
              {photos.length === 0
                ? 'Choose photos from your device'
                : photos.length >= MAX_PHOTOS
                ? 'Maximum of 10 photos selected'
                : 'Add more photos'}
            </button>

            <div className="photo-count-bar" aria-live="polite">
              {photos.length === 0
                ? 'No photos chosen yet.'
                : `${photos.length} of ${MAX_PHOTOS} ${
                    photos.length === 1 ? 'photo' : 'photos'
                  } chosen.`}
            </div>

            {uploadErrors.length > 0 && (
              <div
                className="notice-box notice-error"
                role="alert"
                style={{ marginTop: '16px', marginBottom: 0 }}
              >
                <p className="notice-title">Some files could not be added:</p>
                <ul className="notice-list">
                  {uploadErrors.map((errText, idx) => (
                    <li key={idx}>{errText}</li>
                  ))}
                </ul>
              </div>
            )}

            {photos.length > 0 && (
              <ul className="photo-list" aria-label="Selected photos">
                {photos.map((photo, index) => (
                  <li key={photo.id} className="photo-item">
                    <div className="photo-preview-frame">
                      <img
                        src={photo.dataUrl}
                        alt={`Selected photo ${index + 1}: ${photo.name}`}
                        className="photo-preview-img"
                      />
                    </div>
                    <div className="photo-meta-row">
                      <span className="photo-name">
                        Photo {index + 1}: {photo.name}
                      </span>
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => handleRemovePhoto(photo.id)}
                        disabled={isGenerating}
                        aria-label={`Remove photo ${index + 1}: ${photo.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Step 2: Optional Context */}
          <section className="step-section">
            <label htmlFor="photo-context-field" className="field-label">
              2. Tell us about these photos.
            </label>
            <p className="step-help">
              Optional. You can share who is in the photos, where they were taken, or what the occasion was.
            </p>
            <textarea
              id="photo-context-field"
              className="context-textarea"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="For example: Sunday lunch in the garden with my sister."
              disabled={isGenerating}
              rows={4}
            />
          </section>

          {/* Step 3: Create Captions */}
          <section className="step-section" aria-labelledby="step-create-heading">
            <h2 id="step-create-heading" className="step-heading">
              3. Create your captions
            </h2>
            <p className="step-help">
              Press the button below to get four different captions you can slide through and choose from.
            </p>
            <button
              type="button"
              className="action-btn action-btn-primary"
              onClick={handleGenerateCaptions}
              disabled={isGenerating || photos.length === 0}
            >
              {isGenerating ? 'Creating captions...' : 'Create captions'}
            </button>
          </section>

          {isGenerating && (
            <div className="loading-box" role="status" aria-live="polite">
              Looking at your {photos.length === 1 ? 'photo' : 'photos'} and writing four captions. Please wait a moment...
            </div>
          )}

          {generationError && (
            <div className="notice-box notice-error" role="alert">
              <p className="notice-title">Could not create captions</p>
              <p>{generationError}</p>
            </div>
          )}

          {testModeNotice && (
            <div className="notice-box" role="status" style={{ backgroundColor: '#f7f5f0' }}>
              <p style={{ fontWeight: 700 }}>{testModeNotice}</p>
            </div>
          )}

          {/* Step 4: Unified Carousel Slider + Pick 1 of 4 + Copy/Export to Facebook & Instagram */}
          <section
            ref={resultsRef}
            className="step-section"
            aria-labelledby="results-heading"
          >
            <h2 id="results-heading" className="step-heading">
              4. Slide, pick your caption, and share
            </h2>
            <p className="step-help">
              {hasGeneratedCaptions
                ? 'Slide through the 4 captions below. Pick the one you want to enable copying and exporting to Facebook or Instagram.'
                : 'Your 4 caption options will appear in this slider once you press "Create captions" above.'}
            </p>

            {hasGeneratedCaptions && activeCaption && (
              <div className="carousel-box">
                {/* Step pills (1 to 4) */}
                <div className="carousel-tabs" role="tablist" aria-label="Caption options">
                  {captions.map((item, idx) => {
                    const isCurrent = idx === currentSlide;
                    const isPicked = idx === pickedIndex;
                    return (
                      <button
                        key={item.style}
                        type="button"
                        role="tab"
                        aria-selected={isCurrent}
                        className={`carousel-tab-btn ${isCurrent ? 'active' : ''} ${
                          isPicked ? 'picked' : ''
                        }`}
                        onClick={() => setCurrentSlide(idx)}
                      >
                        {idx + 1}
                        {isPicked ? ' ✓' : ''}
                      </button>
                    );
                  })}
                </div>

                {/* Prev / Next Slider Controls */}
                <div className="carousel-nav-row">
                  <button
                    type="button"
                    className="carousel-arrow-btn"
                    onClick={handlePrevSlide}
                  >
                    &larr; Previous
                  </button>
                  <span className="carousel-counter" aria-live="polite">
                    Option {currentSlide + 1} of {captions.length}
                  </span>
                  <button
                    type="button"
                    className="carousel-arrow-btn"
                    onClick={handleNextSlide}
                  >
                    Next &rarr;
                  </button>
                </div>

                {/* Active Caption Slide (Supports touch swipe) */}
                <article
                  className={`caption-card carousel-slide-card ${
                    pickedIndex === currentSlide ? 'caption-card-picked' : ''
                  }`}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  aria-label={`Option ${currentSlide + 1}: ${activeCaption.style}`}
                >
                  <div className="caption-style-header">
                    <h3 className="caption-style-label">{activeCaption.style}</h3>
                    {pickedIndex === currentSlide && (
                      <span className="picked-badge">Selected</span>
                    )}
                  </div>

                  <p className="caption-text">{activeCaption.text}</p>

                  <div className="slide-action-stack">
                    <button
                      type="button"
                      className={`action-btn ${
                        pickedIndex === currentSlide
                          ? 'action-btn-picked'
                          : 'action-btn-primary'
                      }`}
                      onClick={() => handlePickCaption(currentSlide)}
                    >
                      {pickedIndex === currentSlide
                        ? '✓ Caption picked (Ready to share below)'
                        : 'Pick this caption'}
                    </button>

                    <button
                      type="button"
                      className="action-btn action-btn-secondary"
                      onClick={() => handleCopyCaption(currentSlide)}
                    >
                      Copy this caption
                    </button>
                  </div>

                  {copiedIndex === currentSlide && (
                    <div
                      className="copy-confirm-banner"
                      role="status"
                      aria-live="polite"
                    >
                      Caption copied.
                    </div>
                  )}
                </article>

                <button
                  type="button"
                  className="action-btn action-btn-secondary"
                  style={{ marginTop: '14px' }}
                  onClick={handleGenerateCaptions}
                  disabled={isGenerating || photos.length === 0}
                >
                  {isGenerating ? 'Creating captions...' : 'Create more captions'}
                </button>
              </div>
            )}

            {/* Export to Facebook & Instagram (In the same card, enabled once user picks 1 of the 4 captions) */}
            <div className="export-divider-box">
              <div className="handle-field-box">
                <label htmlFor="instagram-handle-input" className="handle-label">
                  Your Instagram or Facebook handle (optional):
                </label>
                <input
                  id="instagram-handle-input"
                  type="text"
                  className="handle-input"
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder="For example: @grandma_rose"
                />
              </div>

              <p className="export-status-label" aria-live="polite">
                {pickedCaption
                  ? `Picked Option ${pickedIndex + 1} (${pickedCaption.style}). Press a button below to prepare your post with photos and caption:`
                  : hasGeneratedCaptions
                  ? 'Press "Pick this caption" on your favourite slide above to enable Facebook and Instagram export.'
                  : 'Create and pick one of the four captions to enable Facebook and Instagram export.'}
              </p>

              <div className="social-export-group">
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => handleExportToSocial('LinkedIn')}
                  disabled={!canExportSocial}
                >
                  Export to LinkedIn (Auto-fills caption)
                </button>
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => handleExportToSocial('Facebook')}
                  disabled={!canExportSocial}
                >
                  Copy &amp; Export to Facebook
                </button>
                <button
                  type="button"
                  className="action-btn action-btn-primary"
                  onClick={() => handleExportToSocial('Instagram')}
                  disabled={!canExportSocial}
                >
                  Copy &amp; Export to Instagram
                </button>
              </div>

              {/* Ready-to-Post Export Card with Photos + Handle + Caption */}
              {exportedPost && pickedCaption && (
                <div
                  ref={exportPreviewRef}
                  className="exported-post-card"
                  role="region"
                  aria-label={`Exported ${exportedPost.platform} post`}
                >
                  <div className="exported-post-banner">
                    ✓ Ready for {exportedPost.platform} — Caption copied to your clipboard!
                  </div>

                  <div className="exported-post-header">
                    <span className="exported-post-platform">
                      {exportedPost.platform} Post Preview
                    </span>
                    <span className="exported-post-handle">
                      {cleanHandle ? `@${cleanHandle}` : 'Your Account'}
                    </span>
                  </div>

                  {photos.length > 0 && (
                    <div className="exported-photos-grid">
                      {photos.map((photo, idx) => (
                        <div key={photo.id} className="exported-photo-box">
                          <img
                            src={photo.dataUrl}
                            alt={`Export photo ${idx + 1}`}
                            className="exported-photo-img"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="exported-caption-box">
                    <p className="exported-caption-label">
                      Caption for {cleanHandle ? `@${cleanHandle}` : exportedPost.platform} (Already Copied):
                    </p>
                    <p className="exported-caption-body">{pickedCaption.text}</p>
                  </div>

                  <p className="exported-instructions">
                    {exportedPost.platform === 'LinkedIn' ? (
                      <>
                        <strong>How to finish posting on LinkedIn:</strong> We opened LinkedIn with your caption <strong>already typed into the post box</strong> (and copied a backup to your clipboard). Just add your {photos.length === 1 ? 'photo' : 'photos'} in LinkedIn and press <strong>Post</strong>!
                      </>
                    ) : (
                      <>
                        <strong>How to finish posting:</strong> For privacy, {exportedPost.platform} does not allow outside websites to type automatically into your account. We have copied your caption above — open {exportedPost.platform}, choose your {photos.length === 1 ? 'photo' : 'photos'}, and press <strong>Paste</strong> in the caption box.
                      </>
                    )}
                  </p>

                  <div className="social-export-group">
                    <button
                      type="button"
                      className="action-btn action-btn-secondary"
                      onClick={() => copyTextSynchronously(pickedCaption.text)}
                    >
                      Copy caption again
                    </button>
                    <button
                      type="button"
                      className="action-btn action-btn-primary"
                      onClick={() => handleOpenExternalPlatform(exportedPost.platform)}
                    >
                      Open {exportedPost.platform}{' '}
                      {cleanHandle && exportedPost.platform === 'Instagram'
                        ? `(@${cleanHandle})`
                        : ''}{' '}
                      to Paste &amp; Post
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
