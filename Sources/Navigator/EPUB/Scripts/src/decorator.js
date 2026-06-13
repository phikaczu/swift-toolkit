//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import {
  getClientRectsNoOverlap,
  rectContainsPoint,
  toNativeRect,
} from "./rect";
import { log, logErrorMessage, rangeFromLocator } from "./utils";

// Polyfill for iOS 13.3
import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

// === GLOSS P0 PROBE — temporary instrumentation, reverted in revert-instrumentation commit ===
if (!window.__gloss_p0_probe) {
  window.__gloss_p0_probe = [];
}
const __glossP0push = (kind, payload) => {
  window.__gloss_p0_probe.push({ kind, t: Date.now(), ...payload });
};
const __glossP0xpath = (node) => {
  if (!node) return null;
  const parts = [];
  let cur = node;
  while (cur && cur.nodeType !== 9 /* DOCUMENT_NODE */) {
    if (cur.nodeType === 3 /* TEXT_NODE */) {
      let idx = 1;
      let sib = cur.previousSibling;
      while (sib) {
        if (sib.nodeType === 3) idx++;
        sib = sib.previousSibling;
      }
      parts.unshift(`text()[${idx}]`);
    } else {
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
    }
    cur = cur.parentNode;
  }
  return "/" + parts.join("/");
};
// === END GLOSS P0 PROBE setup ===

let styles = new Map();
let groups = new Map();
var lastGroupId = 0;

/**
 * Returns the document body's writing mode.
 */
function getDocumentWritingMode() {
  return getComputedStyle(document.body).writingMode;
}

/**
 * Returns the closest element ancestor of the given node.
 */
function getContainingElement(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

/**
 * Registers a list of additional supported Decoration Templates.
 *
 * Each template object is indexed by the style ID.
 */
export function registerTemplates(newStyles) {
  var stylesheet = "";

  for (const [id, style] of Object.entries(newStyles)) {
    styles.set(id, style);
    if (style.stylesheet) {
      stylesheet += style.stylesheet + "\n";
    }
  }

  if (stylesheet) {
    let styleElement = document.createElement("style");
    styleElement.innerHTML = stylesheet;
    document.getElementsByTagName("head")[0].appendChild(styleElement);
  }
}

/**
 * Returns an instance of DecorationGroup for the given group name.
 */
export function getDecorations(groupName) {
  var group = groups.get(groupName);
  if (!group) {
    let id = "r2-decoration-" + lastGroupId++;
    group = DecorationGroup(id, groupName);
    groups.set(groupName, group);
  }
  return group;
}

/**
 * Handles click events on a Decoration.
 * Returns whether a decoration matched this event.
 */
export function handleDecorationClickEvent(event, clickEvent) {
  let target = findDecorationTarget(event);
  if (!target) {
    return false;
  }
  webkit.messageHandlers.decorationActivated.postMessage({
    id: target.item.decoration.id,
    group: target.group,
    rect: toNativeRect(target.item.range.getBoundingClientRect()),
    click: clickEvent,
  });
  return true;
}

/**
 * Finds any Decoration under the given pointer event, if any.
 */
export function findDecorationTarget(event) {
  if (groups.size === 0) {
    return null;
  }

  for (const [group, groupContent] of groups) {
    if (!groupContent.isActivable()) {
      continue;
    }

    for (const item of groupContent.items.reverse()) {
      if (!item.clickableElements) {
        continue;
      }
      for (const element of item.clickableElements) {
        let rect = element.getBoundingClientRect().toJSON();
        if (rectContainsPoint(rect, event.clientX, event.clientY, 1)) {
          return { group, item, element, rect };
        }
      }
    }
  }
  return null;
}

/**
 * Creates a DecorationGroup object from a unique HTML ID and its name.
 */
export function DecorationGroup(groupId, groupName) {
  var items = [];
  var lastItemId = 0;
  var container = null;
  var activable = false;

  function isActivable() {
    return activable;
  }

  function setActivable() {
    activable = true;
  }

  /**
   * Adds a new decoration to the group.
   */
  function add(decoration) {
    let id = groupId + "-" + lastItemId++;

    let range = rangeFromLocator(decoration.locator);
    if (!range) {
      log("Can't locate DOM range for decoration", decoration);
      return;
    }

    // === GLOSS P0 PROBE A — reconstructed-range fields at add() time ===
    __glossP0push("add-range", {
      decoration_id: decoration.id,
      locator_text_highlight_head: (
        decoration.locator?.text?.highlight ?? ""
      ).slice(0, 60),
      locator_text_before_tail: (decoration.locator?.text?.before ?? "").slice(
        -60
      ),
      locator_text_after_head: (decoration.locator?.text?.after ?? "").slice(
        0,
        60
      ),
      range_start: {
        node: __glossP0xpath(range.startContainer),
        offset: range.startOffset,
        container_tag: range.startContainer.parentElement?.tagName,
      },
      range_end: {
        node: __glossP0xpath(range.endContainer),
        offset: range.endOffset,
        container_tag: range.endContainer.parentElement?.tagName,
      },
      range_collapsed: range.collapsed,
      start_in_indexterm:
        range.startContainer.parentElement?.matches?.(
          'a[data-type="indexterm"]'
        ) ?? false,
      end_in_indexterm:
        range.endContainer.parentElement?.matches?.(
          'a[data-type="indexterm"]'
        ) ?? false,
    });
    // === END GLOSS P0 PROBE A ===

    let item = { id, decoration, range };
    items.push(item);
    layout(item);
  }

  /**
   * Removes the decoration with given ID from the group.
   */
  function remove(decorationId) {
    let index = items.findIndex((i) => i.decoration.id === decorationId);
    if (index === -1) {
      return;
    }

    let item = items[index];
    items.splice(index, 1);
    item.clickableElements = null;
    if (item.container) {
      item.container.remove();
      item.container = null;
    }
  }

  /**
   * Notifies that the given decoration was modified and needs to be updated.
   */
  function update(decoration) {
    remove(decoration.id);
    add(decoration);
  }

  /**
   * Removes all decorations from this group.
   */
  function clear() {
    clearContainer();
    items.length = 0;
  }

  /**
   * Recreates the decoration elements.
   *
   * To be called after reflowing the resource, for example.
   */
  function requestLayout() {
    clearContainer();
    items.forEach((item) => layout(item));
  }

  /**
   * Layouts a single Decoration item.
   */
  function layout(item) {
    let groupContainer = requireContainer();

    let style = styles.get(item.decoration.style);
    if (!style) {
      logErrorMessage(`Unknown decoration style: ${item.decoration.style}`);
      return;
    }

    let itemContainer = document.createElement("div");
    itemContainer.id = item.id;
    itemContainer.dataset.style = item.decoration.style;
    itemContainer.style.pointerEvents = "none";

    const documentWritingMode = getDocumentWritingMode();
    const isVertical =
      documentWritingMode === "vertical-rl" ||
      documentWritingMode === "vertical-lr";

    const scrollingElement = document.scrollingElement;
    const { scrollLeft: xOffset, scrollTop: yOffset } = scrollingElement;
    const viewportWidth = isVertical ? window.innerHeight : window.innerWidth;
    const viewportHeight = isVertical ? window.innerWidth : window.innerHeight;

    const columnCount =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "column-count"
        )
      ) || 1;
    const pageSize =
      (isVertical ? viewportHeight : viewportWidth) / columnCount;

    function positionElement(element, rect, boundingRect, writingMode) {
      element.style.position = "absolute";
      const isVerticalRL = writingMode === "vertical-rl";
      const isVerticalLR = writingMode === "vertical-lr";

      if (isVerticalRL || isVerticalLR) {
        if (style.width === "wrap") {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          if (isVerticalRL) {
            element.style.right = `${
              -rect.right - xOffset + scrollingElement.clientWidth
            }px`;
          } else {
            // vertical-lr
            element.style.left = `${rect.left + xOffset}px`;
          }
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "viewport") {
          element.style.width = `${rect.height}px`;
          element.style.height = `${viewportWidth}px`;
          const top = Math.floor(rect.top / viewportWidth) * viewportWidth;
          if (isVerticalRL) {
            element.style.right = `${-rect.right - xOffset}px`;
          } else {
            // vertical-lr
            element.style.left = `${rect.left + xOffset}px`;
          }
          element.style.top = `${top + yOffset}px`;
        } else if (style.width === "bounds") {
          element.style.width = `${boundingRect.height}px`;
          element.style.height = `${viewportWidth}px`;
          if (isVerticalRL) {
            element.style.right = `${
              -boundingRect.right - xOffset + scrollingElement.clientWidth
            }px`;
          } else {
            // vertical-lr
            element.style.left = `${boundingRect.left + xOffset}px`;
          }
          element.style.top = `${boundingRect.top + yOffset}px`;
        } else if (style.width === "page") {
          element.style.width = `${rect.height}px`;
          element.style.height = `${pageSize}px`;
          const top = Math.floor(rect.top / pageSize) * pageSize;
          if (isVerticalRL) {
            element.style.right = `${
              -rect.right - xOffset + scrollingElement.clientWidth
            }px`;
          } else {
            // vertical-lr
            element.style.left = `${rect.left + xOffset}px`;
          }
          element.style.top = `${top + yOffset}px`;
        }
      } else {
        if (style.width === "wrap") {
          element.style.width = `${rect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${rect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "viewport") {
          element.style.width = `${viewportWidth}px`;
          element.style.height = `${rect.height}px`;
          const left = Math.floor(rect.left / viewportWidth) * viewportWidth;
          element.style.left = `${left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "bounds") {
          element.style.width = `${boundingRect.width}px`;
          element.style.height = `${rect.height}px`;
          element.style.left = `${boundingRect.left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        } else if (style.width === "page") {
          element.style.width = `${pageSize}px`;
          element.style.height = `${rect.height}px`;
          const left = Math.floor(rect.left / pageSize) * pageSize;
          element.style.left = `${left + xOffset}px`;
          element.style.top = `${rect.top + yOffset}px`;
        }
      }
    }

    let boundingRect = item.range.getBoundingClientRect();

    let elementTemplate;
    try {
      let template = document.createElement("template");
      template.innerHTML = item.decoration.element.trim();
      elementTemplate = template.content.firstElementChild;
    } catch (error) {
      logErrorMessage(
        `Invalid decoration element "${item.decoration.element}": ${error.message}`
      );
      return;
    }

    if (style.layout === "boxes") {
      const doNotMergeHorizontallyAlignedRects =
        !documentWritingMode.startsWith("vertical");
      const startElement = getContainingElement(item.range.startContainer);
      // Decorated text may have a different writingMode from document body
      const decoratorWritingMode = getComputedStyle(startElement).writingMode;

      const clientRects = getClientRectsNoOverlap(
        item.range,
        doNotMergeHorizontallyAlignedRects
      ).sort((r1, r2) => {
        if (r1.top !== r2.top) return r1.top - r2.top;
        if (decoratorWritingMode === "vertical-rl") {
          return r2.left - r1.left;
        } else if (decoratorWritingMode === "vertical-lr") {
          return r1.left - r2.left;
        } else {
          return r1.left - r2.left;
        }
      });

      // === GLOSS P0 PROBE B — raw + filtered clientRects at layout() time ===
      const __glossP0rawRects = [...item.range.getClientRects()].map((r) => ({
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      }));
      __glossP0push("layout-rects", {
        decoration_id: item.decoration.id,
        raw_clientRects_count: __glossP0rawRects.length,
        raw_clientRects: __glossP0rawRects,
        post_filter_count: clientRects.length,
        post_filter_rects: clientRects.map((r) => ({
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        })),
      });
      // === END GLOSS P0 PROBE B ===

      for (let clientRect of clientRects) {
        const line = elementTemplate.cloneNode(true);
        line.style.pointerEvents = "none";
        line.dataset.writingMode = decoratorWritingMode;
        positionElement(line, clientRect, boundingRect, documentWritingMode);
        itemContainer.append(line);
      }
    } else if (style.layout === "bounds") {
      const bounds = elementTemplate.cloneNode(true);
      bounds.style.pointerEvents = "none";
      bounds.dataset.writingMode = documentWritingMode;
      positionElement(bounds, boundingRect, boundingRect, documentWritingMode);

      itemContainer.append(bounds);
    }

    groupContainer.append(itemContainer);
    item.container = itemContainer;
    item.clickableElements = Array.from(
      itemContainer.querySelectorAll("[data-activable='1']")
    );
    if (item.clickableElements.length === 0) {
      item.clickableElements = Array.from(itemContainer.children);
    }
  }

  /**
   * Returns the group container element, after making sure it exists.
   */
  function requireContainer() {
    if (!container) {
      container = document.createElement("div");
      container.id = groupId;
      container.dataset.group = groupName;
      container.style.pointerEvents = "none";

      requestAnimationFrame(function () {
        if (container != null) {
          document.body.append(container);
        }
      });
    }
    return container;
  }

  /**
   * Removes the group container.
   */
  function clearContainer() {
    if (container) {
      container.remove();
      container = null;
    }
  }

  return {
    add,
    remove,
    update,
    clear,
    items,
    requestLayout,
    isActivable,
    setActivable,
  };
}

window.addEventListener(
  "load",
  function () {
    // Will relayout all the decorations when the document body is resized.
    const body = document.body;
    var lastSize = { width: 0, height: 0 };
    const observer = new ResizeObserver(() => {
      if (
        lastSize.width === body.clientWidth &&
        lastSize.height === body.clientHeight
      ) {
        return;
      }
      lastSize = {
        width: body.clientWidth,
        height: body.clientHeight,
      };

      groups.forEach(function (group) {
        group.requestLayout();
      });
    });
    observer.observe(body);
  },
  false
);
