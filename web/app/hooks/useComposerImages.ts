"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  blobToDataUrl,
  journalImageErrorMessage,
  processJournalImage,
} from "../lib/image";
import { MAX_JOURNAL_IMAGES } from "../lib/journal-images";
import type { JournalImage, JournalReader } from "../lib/local-vault";
import type { Language } from "./useAppearance";

export type ComposerImage = {
  id: string;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: string;
  blob?: Blob;
  dataUrl?: string;
};

type UseComposerImagesOptions = {
  isVaultLocked: boolean;
  journalReader: JournalReader;
  language: Language;
  lowSpecMode: boolean;
  saving: boolean;
  showToast: (message: string) => void;
  vaultLockedRef: MutableRefObject<boolean>;
};

export function useComposerImages({
  isVaultLocked,
  journalReader,
  language,
  lowSpecMode,
  saving,
  showToast,
  vaultLockedRef,
}: UseComposerImagesOptions) {
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [imagesChanged, setImagesChanged] = useState(false);
  const [editingImageState, setEditingImageState] = useState<"ready" | "loading" | "failed">("ready");
  const [imageProcessing, setImageProcessing] = useState(false);

  const previewUrlsRef = useRef(new Set<string>());
  const imageBusyRef = useRef(false);
  const imageRequestRef = useRef(0);
  const editingContentVersionRef = useRef<string | null>(null);

  const clearImages = useCallback(() => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
    setImages([]);
    setImagesChanged(false);
    setEditingImageState("ready");
  }, []);

  const cancelImageRequests = useCallback(() => {
    imageRequestRef.current++;
  }, []);

  useEffect(
    () => () => {
      imageRequestRef.current++;
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    },
    [],
  );

  const loadEditingImages = useCallback(
    async (id: string) => {
      const request = ++imageRequestRef.current;
      setEditingImageState("loading");
      try {
        const summary = await journalReader.summary(id);
        const loaded = await journalReader.images(summary);
        if (request !== imageRequestRef.current || vaultLockedRef.current) return;
        setImages(
          loaded.map((image) => ({
            ...image,
            id: image.id ?? `legacy-${id}`,
            previewUrl: image.dataUrl,
          })),
        );
        setImagesChanged(false);
        editingContentVersionRef.current = summary.contentVersion;
        setEditingImageState("ready");
      } catch {
        if (request !== imageRequestRef.current) return;
        setEditingImageState("failed");
        showToast(
          language === "ko"
            ? "기존 사진을 불러오지 못했습니다. 다시 시도해 주세요."
            : "Could not load existing photos. Please retry.",
        );
      }
    },
    [journalReader, language, showToast, vaultLockedRef],
  );

  const handleImage = useCallback(
    async (files: File[] = [], replaceId?: string) => {
      if (
        !files.length ||
        imageBusyRef.current ||
        saving ||
        isVaultLocked ||
        editingImageState !== "ready"
      ) {
        return;
      }
      if (
        (!replaceId && images.length + files.length > MAX_JOURNAL_IMAGES) ||
        (replaceId && files.length !== 1)
      ) {
        showToast(
          language === "ko"
            ? "사진은 최대 4장까지 첨부할 수 있습니다."
            : "You can attach up to 4 photos.",
        );
        return;
      }
      imageBusyRef.current = true;
      const request = ++imageRequestRef.current;
      setImageProcessing(true);
      try {
        for (const file of files) {
          try {
            const processed = await processJournalImage(file, lowSpecMode);
            if (request !== imageRequestRef.current || vaultLockedRef.current) {
              URL.revokeObjectURL(processed.previewUrl);
              return;
            }
            const previous = replaceId
              ? images.find((image) => image.id === replaceId)
              : undefined;
            if (previous && previewUrlsRef.current.delete(previous.previewUrl)) {
              URL.revokeObjectURL(previous.previewUrl);
            }
            previewUrlsRef.current.add(processed.previewUrl);
            const next: ComposerImage = { ...processed, id: crypto.randomUUID() };
            setImages((previous) =>
              replaceId
                ? previous.map((image) => (image.id === replaceId ? next : image))
                : [...previous, next],
            );
            setImagesChanged(true);
          } catch (error) {
            if (request !== imageRequestRef.current) return;
            showToast(`${file.name}: ${journalImageErrorMessage(error, language)}`);
          }
        }
      } finally {
        imageBusyRef.current = false;
        setImageProcessing(false);
      }
    },
    [
      editingImageState,
      images,
      isVaultLocked,
      language,
      lowSpecMode,
      saving,
      showToast,
      vaultLockedRef,
    ],
  );

  const removeImage = useCallback(
    (id: string) => {
      if (saving || imageBusyRef.current || editingImageState !== "ready") return;
      const image = images.find((item) => item.id === id);
      if (image && previewUrlsRef.current.delete(image.previewUrl)) {
        URL.revokeObjectURL(image.previewUrl);
      }
      setImages((previous) => previous.filter((item) => item.id !== id));
      setImagesChanged(true);
    },
    [editingImageState, images, saving],
  );

  const serializeComposerImages = useCallback(
    (): Promise<JournalImage[]> =>
      Promise.all(
        images.map(async (image) => ({
          id: image.id,
          dataUrl: image.dataUrl ?? (await blobToDataUrl(image.blob!)),
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
        })),
      ),
    [images],
  );

  return {
    cancelImageRequests,
    clearImages,
    editingContentVersionRef,
    editingImageState,
    handleImage,
    imageBusyRef,
    imageProcessing,
    images,
    imagesChanged,
    loadEditingImages,
    removeImage,
    serializeComposerImages,
  };
}
