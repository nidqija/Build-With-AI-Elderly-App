import React, { useState, useRef } from 'react';
import './App.css';

const MAX_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
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
  const [uploadErrors, setUploadErrors] = useState([]);
  const [generationError, setGenerationError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [captions, setCaptions] = useState([]);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [pickedIndex, setPickedIndex] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [shareNotice, setShareNotice] = useState('');

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
      setUploadErrors(['Maximum 10 photos allowed.']);
      return;
    }

    const filesToProcess = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > remainingSlots) {
      newErrors.push('Maximum 10 photos allowed.');
    }

    const validLoadedPhotos = [];

    for (const file of filesToProcess) {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        newErrors.push(`"${file.name}" is not a JPG, PNG, WebP, or GIF photo.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        newErrors.push(`"${file.name}" is over 10 MB.`);
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
        newErrors.push(`Could not open "${file.name}".`);
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
      setGenerationError('Please choose at least one photo.');
      return;
    }

    inFlightRef.current = true;
    setIsGenerating(true);
    setGenerationError('');
    setCopiedIndex(null);
    setPickedIndex(null);
    setCurrentSlide(0);
    setShareNotice('');

    try {
      const response = await fetch('/api/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const nextCaptions =
        response.ok && Array.isArray(data?.captions) && data.captions.length > 0
          ? data.captions
          : buildClientFallbackCaptions(context, photos.length);

      setCaptions(nextCaptions);
      setCurrentSlide(0);
      setPickedIndex(null);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    } catch {
      setCaptions(buildClientFallbackCaptions(context, photos.length));
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
      if (diff > 45) handleNextSlide();
      else if (diff < -45) handlePrevSlide();
    }
    touchStartXRef.current = null;
  };

  const handlePickCaption = (index) => {
    if (!hasGeneratedCaptions) return;
    setPickedIndex(index);
  };

  const handleCopyCaption = (index) => {
    const target = captions[index];
    if (!target?.text) return;
    if (copyTextSynchronously(target.text)) {
      setPickedIndex(index);
      setCopiedIndex(index);
    }
  };

  const handleShareToOtherPlatforms = async () => {
    if (!pickedCaption) return;
    const captionToShare = pickedCaption.text;
    copyTextSynchronously(captionToShare);
    setCopiedIndex(pickedIndex);

    const rawFiles = photos.map((p) => p.file).filter(Boolean);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const canShareFiles =
        typeof navigator.canShare === 'function' &&
        rawFiles.length > 0 &&
        navigator.canShare({ files: rawFiles });

      try {
        if (canShareFiles) {
          await navigator.share({
            files: rawFiles,
            text: captionToShare,
          });
        } else {
          await navigator.share({
            text: captionToShare,
          });
        }
        setShareNotice('Caption copied and share menu opened.');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }

    setShareNotice('Caption copied — paste it into any app you like.');
  };

  return (
    <div className="page-shell">
      <div className="mobile-container">
        <header className="page-header">
          <h1 className="page-title">Create a caption for your photos.</h1>
          <div className="page-steps-bar" aria-label="How it works">
            <span className="step-pill">1. Choose your photos</span>
            <span className="step-pill">2. Pick a caption</span>
            <span className="step-pill">3. Copy and share</span>
          </div>
        </header>

        <main>
          {/* 1. Photos */}
          <section className="step-section">
            <h2 className="step-heading">1. Photos ({photos.length}/10)</h2>

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
              {photos.length === 0 ? 'Choose photos' : 'Add photos'}
            </button>

            {uploadErrors.length > 0 && (
              <div
                className="notice-box notice-error"
                role="alert"
                style={{ marginTop: '12px', marginBottom: 0 }}
              >
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
                        alt={photo.name}
                        className="photo-preview-img"
                      />
                    </div>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => handleRemovePhoto(photo.id)}
                      disabled={isGenerating}
                      aria-label={`Remove photo ${index + 1}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2. Context */}
          <section className="step-section">
            <label htmlFor="photo-context-field" className="field-label">
              2. Tell us about these photos.
            </label>
            <textarea
              id="photo-context-field"
              className="context-textarea"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Optional notes..."
              disabled={isGenerating}
              rows={3}
            />
          </section>

          {/* 3. Create Captions */}
          <section className="step-section">
            <button
              type="button"
              className="action-btn action-btn-primary"
              onClick={handleGenerateCaptions}
              disabled={isGenerating || photos.length === 0}
            >
              {isGenerating ? 'Creating captions...' : 'Create captions'}
            </button>
          </section>

          {generationError && (
            <div className="notice-box notice-error" role="alert">
              <p>{generationError}</p>
            </div>
          )}

          {/* 4. Carousel & Share */}
          <section ref={resultsRef} className="step-section">
            <h2 className="step-heading">3. Pick &amp; Share</h2>

            {hasGeneratedCaptions && activeCaption && (
              <div className="carousel-box">
                <div className="carousel-tabs" role="tablist">
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

                <div className="carousel-nav-row">
                  <button
                    type="button"
                    className="carousel-arrow-btn"
                    onClick={handlePrevSlide}
                  >
                    &larr; Prev
                  </button>
                  <span className="carousel-counter">
                    {currentSlide + 1} / {captions.length}
                  </span>
                  <button
                    type="button"
                    className="carousel-arrow-btn"
                    onClick={handleNextSlide}
                  >
                    Next &rarr;
                  </button>
                </div>

                <article
                  className={`caption-card ${
                    pickedIndex === currentSlide ? 'caption-card-picked' : ''
                  }`}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  <div className="caption-style-header">
                    <h3 className="caption-style-label">{activeCaption.style}</h3>
                    {pickedIndex === currentSlide && (
                      <span className="picked-badge">Picked</span>
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
                      {pickedIndex === currentSlide ? '✓ Picked' : 'Pick this caption'}
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
                    <div className="copy-confirm-banner" role="status">
                      Caption copied.
                    </div>
                  )}
                </article>

                <button
                  type="button"
                  className="action-btn action-btn-secondary"
                  style={{ marginTop: '12px' }}
                  onClick={handleGenerateCaptions}
                  disabled={isGenerating || photos.length === 0}
                >
                  Create more captions
                </button>
              </div>
            )}

            <div className="social-export-group">
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={handleShareToOtherPlatforms}
                disabled={!canExportSocial}
              >
                Share to other platforms
              </button>
            </div>

            {shareNotice && (
              <div className="copy-confirm-banner" role="status">
                {shareNotice}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
