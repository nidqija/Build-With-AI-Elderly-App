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

async function copyTextToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to textarea selection copy below
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.top = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  document.body.removeChild(textArea);
  return copied;
}

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [context, setContext] = useState('');
  const [uploadErrors, setUploadErrors] = useState([]);
  const [generationError, setGenerationError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [captions, setCaptions] = useState([]);
  const [testModeNotice, setTestModeNotice] = useState('');

  // Carousel state: currentIndex is which slide the user is viewing (0..3)
  // pickedIndex is which caption the user explicitly chose (null until they pick one)
  const [currentSlide, setCurrentSlide] = useState(0);
  const [pickedIndex, setPickedIndex] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [exportNotice, setExportNotice] = useState('');

  const fileInputRef = useRef(null);
  const inFlightRef = useRef(false);
  const resultsRef = useRef(null);
  const touchStartXRef = useRef(null);

  const hasGeneratedCaptions = captions.length > 0;
  const activeCaption = hasGeneratedCaptions ? captions[currentSlide] : null;
  const pickedCaption =
    hasGeneratedCaptions && pickedIndex !== null ? captions[pickedIndex] : null;
  const canExportSocial = Boolean(pickedCaption && !isGenerating);

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
        validLoadedPhotos.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          file,
          dataUrl,
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
    setExportNotice('');

    try {
      const response = await fetch('/api/captions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          photos: photos.map((photo) => ({
            name: photo.name,
            mimeType: photo.mimeType,
            dataUrl: photo.dataUrl,
          })),
          context: context.trim(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error ||
            'We could not create captions right now. Please wait a moment and try again.'
        );
      }

      if (!Array.isArray(data?.captions) || data.captions.length === 0) {
        throw new Error('No captions were returned. Please try again.');
      }

      setCaptions(data.captions);
      setTestModeNotice(typeof data.notice === 'string' ? data.notice : '');
      setCurrentSlide(0);
      setPickedIndex(null);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    } catch (err) {
      setGenerationError(
        err?.message ||
          'We could not create captions right now. Please check your internet connection and try again.'
      );
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

  const handlePickCaption = async (index) => {
    if (!hasGeneratedCaptions) return;
    setPickedIndex(index);
    setExportNotice('');
  };

  const handleCopyCaption = async (index) => {
    const target = captions[index];
    if (!target?.text) return;
    const ok = await copyTextToClipboard(target.text);
    if (ok) {
      setPickedIndex(index);
      setCopiedIndex(index);
      setExportNotice('');
    } else {
      setGenerationError(
        'We could not copy the caption automatically. You can press and hold the caption text to copy it.'
      );
    }
  };

  const handleExportToSocial = async (platform) => {
    if (!pickedCaption) return;

    const captionToShare = pickedCaption.text;
    await copyTextToClipboard(captionToShare);
    setCopiedIndex(pickedIndex);

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
          title: `Share to ${platform}`,
        });
        setExportNotice(
          `Caption copied. Choose ${platform} from your device share menu to post your ${
            rawFiles.length === 1 ? 'photo' : `${rawFiles.length} photos`
          }, then paste the copied caption.`
        );
        return;
      } catch (err) {
        if (err?.name === 'AbortError') {
          return;
        }
      }
    }

    const targetUrl =
      platform === 'Instagram'
        ? 'https://www.instagram.com/'
        : 'https://www.facebook.com/';

    window.open(targetUrl, '_blank', 'noopener,noreferrer');

    const photoSummary =
      photos.length === 1
        ? `your photo (${photos[0].name})`
        : `your ${photos.length} photos`;

    setExportNotice(
      `Caption copied and ${platform} opened in a new window. Select ${photoSummary} in ${platform} and paste your caption.`
    );
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
              <p className="export-status-label" aria-live="polite">
                {pickedCaption
                  ? `Picked Option ${pickedIndex + 1} (${pickedCaption.style}). You can now copy and export to Facebook or Instagram:`
                  : hasGeneratedCaptions
                  ? 'Press "Pick this caption" on your favourite slide above to enable Facebook and Instagram export.'
                  : 'Create and pick one of the four captions to enable Facebook and Instagram export.'}
              </p>

              <div className="social-export-group">
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

              {exportNotice && (
                <div
                  className="copy-confirm-banner"
                  role="status"
                  aria-live="polite"
                >
                  <p>Caption copied.</p>
                  <p className="export-notice-detail">{exportNotice}</p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
