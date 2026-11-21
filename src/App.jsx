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
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [selectedCaptionIndex, setSelectedCaptionIndex] = useState(0);
  const [exportNotice, setExportNotice] = useState('');

  const fileInputRef = useRef(null);
  const inFlightRef = useRef(false);
  const resultsRef = useRef(null);

  const hasGeneratedCaptions = captions.length > 0;

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
      setSelectedCaptionIndex(0);
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

  const handleCopyCaption = async (text, index) => {
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedIndex(index);
      setSelectedCaptionIndex(index);
    } else {
      setGenerationError(
        'We could not copy the caption automatically. You can press and hold the caption text to copy it.'
      );
    }
  };

  const handleExportToSocial = async (platform) => {
    if (!hasGeneratedCaptions) return;

    const activeIndex =
      copiedIndex !== null ? copiedIndex : selectedCaptionIndex;
    const captionToShare =
      captions[activeIndex]?.text || captions[0]?.text || '';

    if (captionToShare) {
      await copyTextToClipboard(captionToShare);
      setCopiedIndex(activeIndex);
    }

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
              Press the button below to get four different captions you can choose from.
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

          {/* Step 4: Generated Captions (shown once captions are created) */}
          {hasGeneratedCaptions && (
            <section
              ref={resultsRef}
              className="results-section"
              aria-labelledby="results-heading"
            >
              <h2 id="results-heading" className="results-heading">
                Your four caption options
              </h2>
              <p className="results-intro">
                Read the four options below and press &ldquo;Copy this caption&rdquo; under the one you prefer.
              </p>

              <div className="captions-stack">
                {captions.map((caption, index) => {
                  const isCopied = copiedIndex === index;
                  return (
                    <article
                      key={`${caption.style}-${index}`}
                      className="caption-card"
                      aria-label={`Caption option ${index + 1}: ${caption.style}`}
                    >
                      <h3 className="caption-style-label">
                        {caption.style}
                      </h3>
                      <p className="caption-text">{caption.text}</p>
                      <button
                        type="button"
                        className="action-btn action-btn-primary"
                        onClick={() => handleCopyCaption(caption.text, index)}
                      >
                        Copy this caption
                      </button>

                      {isCopied && (
                        <div
                          className="copy-confirm-banner"
                          role="status"
                          aria-live="polite"
                        >
                          Caption copied.
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="more-captions-box">
                <p className="more-captions-note">
                  Would you like four different ideas for these same photos and notes?
                </p>
                <button
                  type="button"
                  className="action-btn action-btn-secondary"
                  onClick={handleGenerateCaptions}
                  disabled={isGenerating || photos.length === 0}
                >
                  {isGenerating ? 'Creating captions...' : 'Create more captions'}
                </button>
              </div>
            </section>
          )}

          {/* Unified Export to Facebook & Instagram Section (Always visible, enabled once captions are generated) */}
          <section
            className="step-section"
            style={{ marginTop: '24px' }}
            aria-labelledby="quick-export-heading"
          >
            <h2 id="quick-export-heading" className="step-heading">
              4. Export photos and caption to Facebook or Instagram
            </h2>
            <p className="step-help">
              {hasGeneratedCaptions
                ? 'Press a button below to copy your chosen caption and share your photos to Facebook or Instagram.'
                : 'Create your captions in Step 3 to enable exporting your photos and caption to Facebook or Instagram.'}
            </p>

            <div className="social-export-group" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={() => handleExportToSocial('Facebook')}
                disabled={!hasGeneratedCaptions || isGenerating}
              >
                Export photos and caption to Facebook
              </button>
              <button
                type="button"
                className="action-btn action-btn-primary"
                onClick={() => handleExportToSocial('Instagram')}
                disabled={!hasGeneratedCaptions || isGenerating}
              >
                Export photos and caption to Instagram
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
          </section>
        </main>
      </div>
    </div>
  );
}
