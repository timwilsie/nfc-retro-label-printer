import {
  FabricImage,
  util,
  Point,
  type StaticCanvas,
  Shadow,
  loadSVGFromURL,
  Group,
  FabricObject,
  Color,
  Gradient,
  type Canvas,
  type SerializedGroupProps,
} from 'fabric';
import { cardLikeOptions } from '../constants';
import { type templateType, type templateOverlay } from '../cardsTemplates';

FabricObject.ownDefaults.objectCaching = false;

export const scaleImageToOverlayArea = (
  template: templateType,
  overlayImg: FabricObject,
  mainImage: FabricImage,
) => {
  const { overlay } = template;
  // scale the art to the designed area in the template. to fit
  // TODO: add option later for fit or cover
  const isRotated = mainImage.angle % 180 !== 0;
  const scaledTemplateOverlaySize = overlayImg._getTransformedDimensions();
  const pictureScaleToTemplate = util.findScaleToFit(
    {
      width: isRotated ? mainImage.height : mainImage.width,
      height: isRotated ? mainImage.width : mainImage.height,
    },
    {
      width: scaledTemplateOverlaySize.x * overlay!.width,
      height: scaledTemplateOverlaySize.y * overlay!.height,
    },
  );
  mainImage.set({
    scaleX: pictureScaleToTemplate,
    scaleY: pictureScaleToTemplate,
  });
  // get the top left corner of the template overlay
  const templatePostion = overlayImg.translateToGivenOrigin(
    overlayImg.getRelativeXY(),
    'center',
    'center',
    'left',
    'top',
  );
  mainImage.setPositionByOrigin(
    new Point(
      scaledTemplateOverlaySize.x * (overlay!.x + overlay!.width / 2) +
        templatePostion.x,
      scaledTemplateOverlaySize.y * (overlay!.y + overlay!.height / 2) +
        templatePostion.y,
    ),
    'center',
    'center',
  );
  mainImage.setCoords();
};

/**
 * extract and normalizes to hex format colors in the objects
 * remove opacity from colors and sets it on the objects
 * @param group
 */
// TODO: supports gradients and objects with different opacity
const extractUniqueColorsFromGroup = (group: Group): string[] => {
  const colors: string[] = [];
  group.forEachObject((object) => {
    (['stroke', 'fill'] as const).forEach((property) => {
      if (
        object[property] &&
        object[property] !== 'transparent' &&
        !(object[property] as Gradient<'linear'>).colorStops
      ) {
        const colorInstance = new Color(object[property] as string);
        const hexValue = `#${colorInstance.toHex()}`;
        const opacity = colorInstance.getAlpha();
        object[property] = hexValue;
        object.set({
          [property]: hexValue,
          [`original_${property}`]: hexValue,
        });
        object.opacity = opacity;
        if (!colors.includes(hexValue)) {
          colors.push(hexValue);
        }
      }
    });
  });
  return colors;
};

const parseSvg = (url: string): Promise<SerializedGroupProps> =>
  loadSVGFromURL(url).then(({ objects }) => {
    const nonNullObjects = objects.filter(
      (objects) => !!objects,
    ) as FabricObject[];
    const group = new Group(nonNullObjects);
    extractUniqueColorsFromGroup(group);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return group.toObject(['original_stroke', 'original_fill']);
  });

const reposition = (
  fabricLayer: FabricObject,
  layout: 'horizontal' | 'vertical',
): void => {
  if (layout === 'horizontal') {
    fabricLayer.left = cardLikeOptions.width / 2;
    fabricLayer.top = cardLikeOptions.height / 2;
  } else {
    fabricLayer.left = cardLikeOptions.height / 2;
    fabricLayer.top = cardLikeOptions.width / 2;
  }
  fabricLayer.setCoords();
};

export const setTemplateOnCanvases = async (
  canvases: StaticCanvas[],
  template: templateType,
): Promise<string[]> => {
  const { overlay, background, shadow, layout } = template || {};
  const [overlayImageSource, backgroundImageSource] = await Promise.all([
    overlay &&
      (overlay.parsed
        ? overlay.parsed
        : overlay.isSvg
          ? (overlay.parsed = parseSvg(overlay.url))
          : (overlay.parsed = util.loadImage(overlay.url))),
    background &&
      ((background.parsed
        ? background.parsed
        : background.isSvg
          ? (background.parsed = parseSvg(background.url))
          : (background.parsed = util.loadImage(
              background.url,
            ))) as unknown as HTMLImageElement),
  ]);

  const overlayImageElement =
    overlayImageSource &&
    (overlayImageSource instanceof HTMLImageElement
      ? overlayImageSource
      : await Group.fromObject(overlayImageSource));
  const backgroundImageElement =
    backgroundImageSource &&
    (backgroundImageSource instanceof HTMLImageElement
      ? backgroundImageSource
      : await Group.fromObject(backgroundImageSource));
  const isHorizontal = layout === 'horizontal';
  const { width, height } = cardLikeOptions;
  const finalWidth = isHorizontal ? width : height;
  const finalHeight = isHorizontal ? height : width;

  for (const canvas of canvases) {
    // resize only if necessary
    if (finalHeight !== canvas.height || finalWidth !== canvas.width) {
      canvas.setDimensions(
        {
          width: finalWidth,
          height: finalHeight,
        },
        { backstoreOnly: true },
      );
    }
    const mainImage = canvas.getObjects('image')[0] as FabricImage;
    mainImage.shadow = shadow
      ? new Shadow({ ...Shadow.parseShadow(shadow), nonScaling: true })
      : null;

    const couple1 = [overlayImageElement, overlay, overlayImageSource] as [
      Group | HTMLImageElement,
      templateOverlay,
      SerializedGroupProps | HTMLImageElement | undefined,
    ];
    const couple2 = [
      backgroundImageElement,
      background,
      backgroundImageSource,
    ] as [
      Group | HTMLImageElement,
      templateOverlay,
      SerializedGroupProps | HTMLImageElement | undefined,
    ];
    const couples = [couple1, couple2] as const;

    for (const [layer, templateLayer, layerSource] of couples) {
      if (layer) {
        // scale the overlay asset to cover the designed layer size
        // example: the template is supposed to be smaller than the card
        const source = {
          width: layer.width,
          height: layer.height,
        };
        const scale = util.findScaleToCover(source, {
          width: templateLayer!.layerWidth,
          height: templateLayer!.layerHeight,
        });
        let fabricLayer;
        if (layer instanceof Group) {
          fabricLayer = await Group.fromObject(
            layerSource as SerializedGroupProps,
          );
          fabricLayer.canvas = canvas as Canvas;
        } else {
          fabricLayer = new FabricImage(layer, {
            canvas,
            scaleX: scale,
            scaleY: scale,
          });
        }
        // set the overlay of the template in the center of the card
        reposition(fabricLayer, template.layout);
        if (templateLayer === overlay) {
          scaleImageToOverlayArea(template, fabricLayer, mainImage);
          canvas.overlayImage = fabricLayer;
        }
        if (templateLayer === background) {
          canvas.backgroundImage = fabricLayer;
        }
      } else {
        // reset to blank
        if (templateLayer === overlay) {
          canvas.overlayImage = undefined;
          // reset image size
          const destination =
            template?.layout === 'horizontal'
              ? cardLikeOptions
              : {
                  width: cardLikeOptions.height,
                  height: cardLikeOptions.width,
                };
          const pictureScale = util.findScaleToCover(mainImage, destination);
          mainImage.set({
            scaleX: pictureScale,
            scaleY: pictureScale,
            left: destination.width / 2,
            top: destination.height / 2,
          });
          mainImage.setCoords();
        }
        if (templateLayer === background) {
          canvas.backgroundImage = canvas.clipPath;
          const backgroundImg = canvas.backgroundImage!;
          reposition(backgroundImg, template.layout);
        }
      }
    }

    const { clipPath } = canvas;
    if (clipPath) {
      if (template.layout === 'horizontal') {
        clipPath.angle = 0;
      } else {
        clipPath.angle = 90;
      }
      reposition(clipPath, template.layout);
    }
    canvas.requestRenderAll();
  }
  // this could returned by the promise right away
  const colors: string[] = [];
  if (overlayImageElement instanceof Group) {
    colors.push(...extractUniqueColorsFromGroup(overlayImageElement));
  }
  if (backgroundImageElement instanceof Group) {
    colors.push(...extractUniqueColorsFromGroup(backgroundImageElement));
  }
  return colors;
};
