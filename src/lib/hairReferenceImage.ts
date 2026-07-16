const ALLOWED_REFERENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_DATA_BYTES = 4 * 1024 * 1024;
const MAX_REFERENCE_EDGE = 1024;
const MAX_REFERENCE_PIXELS = 40_000_000;

export type PreparedHairReference = {
  dataUrl: string;
  width: number;
  height: number;
};

export function validateHairReferenceFile(file: Pick<File, 'size' | 'type'>): string | null {
  if (!ALLOWED_REFERENCE_TYPES.has(file.type.toLowerCase())) {
    return 'Choose a JPEG, PNG, or WebP image.';
  }
  if (file.size <= 0) return 'That image is empty. Choose another one.';
  if (file.size > MAX_REFERENCE_FILE_BYTES) return 'Reference images must be 10 MB or smaller.';
  return null;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read that image.'));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari and a few older mobile codecs sometimes work through <img> only.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file could not be decoded as an image.'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageSize(image: ImageBitmap | HTMLImageElement) {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

/**
 * Normalizes a local reference before it enters the JSON request. The resize
 * keeps mobile photos from exceeding platform body limits; raw-file fallback
 * preserves support in browsers whose canvas encoder is unavailable.
 */
export async function prepareHairReference(file: File): Promise<PreparedHairReference> {
  const validationError = validateHairReferenceFile(file);
  if (validationError) throw new Error(validationError);

  const image = await decodeImage(file);
  const { width, height } = imageSize(image);
  if (width < 1 || height < 1 || width * height > MAX_REFERENCE_PIXELS) {
    if ('close' in image) image.close();
    throw new Error('That image is too large to process. Choose a smaller one.');
  }

  const scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    const blob = await canvasBlob(canvas);
    if (!blob) throw new Error('Image encoding failed');
    if (blob.size > MAX_REFERENCE_DATA_BYTES) throw new Error('The processed image is still too large.');
    return { dataUrl: await readAsDataUrl(blob), width: outputWidth, height: outputHeight };
  } catch (error) {
    // A small original is still safe to send if browser-side re-encoding fails.
    if (file.size <= MAX_REFERENCE_DATA_BYTES) {
      return { dataUrl: await readAsDataUrl(file), width, height };
    }
    throw error instanceof Error ? error : new Error('Could not prepare that image.');
  } finally {
    if ('close' in image) image.close();
  }
}
