﻿// Copyright (c) Microsoft Corporation.  All Rights Reserved. Licensed under the MIT License. See License.txt in the project root for license information.
/// <dictionary>appbar,Flyout,Flyouts,Statics</dictionary>
define([
    'exports',
    '../Core/_Global',
    '../Core/_Base',
    '../Core/_BaseUtils',
    '../Core/_ErrorFromName',
    '../Core/_Events',
    '../Core/_Log',
    '../Core/_Resources',
    '../Core/_WriteProfilerMark',
    '../Animations',
    '../_Signal',
    '../Utilities/_Dispose',
    '../Utilities/_ElementUtilities',
    '../Utilities/_Hoverable',
    './_LegacyAppBar/_Constants',
    './Flyout/_Overlay'
], function flyoutInit(exports, _Global, _Base, _BaseUtils, _ErrorFromName, _Events, _Log, _Resources, _WriteProfilerMark, Animations, _Signal, _Dispose, _ElementUtilities, _Hoverable, _Constants, _Overlay) {
    "use strict";

    _Base.Namespace._moduleDefine(exports, "WinJS.UI", {
        /// <field>
        /// <summary locid="WinJS.UI.Flyout">
        /// Displays lightweight UI that is either informational, or requires user interaction.
        /// Unlike a dialog, a Flyout can be light dismissed by clicking or tapping off of it.
        /// </summary>
        /// <compatibleWith platform="Windows" minVersion="8.0"/>
        /// </field>
        /// <name locid="WinJS.UI.Flyout_name">Flyout</name>
        /// <icon src="ui_winjs.ui.flyout.12x12.png" width="12" height="12" />
        /// <icon src="ui_winjs.ui.flyout.16x16.png" width="16" height="16" />
        /// <htmlSnippet supportsContent="true"><![CDATA[<div data-win-control="WinJS.UI.Flyout"></div>]]></htmlSnippet>
        /// <event name="beforeshow" locid="WinJS.UI.Flyout_e:beforeshow">Raised just before showing a flyout.</event>
        /// <event name="aftershow" locid="WinJS.UI.Flyout_e:aftershow">Raised immediately after a flyout is fully shown.</event>
        /// <event name="beforehide" locid="WinJS.UI.Flyout_e:beforehide">Raised just before hiding a flyout.</event>
        /// <event name="afterhide" locid="WinJS.UI.Flyout_e:afterhide">Raised immediately after a flyout is fully hidden.</event>
        /// <part name="flyout" class="win-flyout" locid="WinJS.UI.Flyout_part:flyout">The Flyout control itself.</part>
        /// <resource type="javascript" src="//$(TARGET_DESTINATION)/js/WinJS.js" shared="true" />
        /// <resource type="css" src="//$(TARGET_DESTINATION)/css/ui-dark.css" shared="true" />
        Flyout: _Base.Namespace._lazy(function () {
            var Key = _ElementUtilities.Key;

            function getDimension(element, property) {
                return parseFloat(element, _Global.getComputedStyle(element, null)[property]);
            }

            var strings = {
                get ariaLabel() { return _Resources._getWinJSString("ui/flyoutAriaLabel").value; },
                get noAnchor() { return "Invalid argument: Flyout anchor element not found in DOM."; },
                get badPlacement() { return "Invalid argument: Flyout placement should be 'top' (default), 'bottom', 'left', 'right', 'auto', 'autohorizontal', or 'autovertical'."; },
                get badAlignment() { return "Invalid argument: Flyout alignment should be 'center' (default), 'left', or 'right'."; }
            };

            var createEvent = _Events._createEventProperty;

            // Singleton class for managing cascading flyouts
            var _CascadeManager = _Base.Class.define(function _CascadeManager_ctor() {
                this._cascadingStack = [];
                this._handleKeyDownInCascade_bound = this._handleKeyDownInCascade.bind(this);
            },
            {
                appendFlyout: function _CascadeManager_appendFlyout(flyoutToAdd) {
                    // PRECONDITION: flyoutToAdd must not already be in the cascade.
                    _Log.log && this.indexOf(flyoutToAdd) >= 0 && _Log.log('_CascadeManager is attempting to append a Flyout that is already in the cascade.', "winjs _CascadeManager", "error");
                    // PRECONDITION: this.reentrancyLock must be false. appendFlyout should only be called from baseFlyoutShow() which is the function responsible for preventing reentrancy.
                    _Log.log && this.reentrancyLock && _Log.log('_CascadeManager is attempting to append a Flyout through reentrancy.', "winjs _CascadeManager", "error");

                    // IF the anchor element for flyoutToAdd is contained within another flyout,
                    // && that flyout is currently in the cascadingStack, consider that flyout to be the parent of flyoutToAdd:
                    //  Remove from the cascadingStack, any subflyout descendants of the parent flyout.
                    // ELSE flyoutToAdd isn't anchored to any of the Flyouts in the existing cascade
                    //  Collapse the entire cascadingStack to start a new cascade.
                    // FINALLY:
                    //  add flyoutToAdd to the end of the cascading stack. Monitor it for events.
                    var indexOfParentFlyout = this.indexOfElement(flyoutToAdd._currentAnchor);
                    if (indexOfParentFlyout >= 0) {
                        this.collapseFlyout(this.getAt(indexOfParentFlyout + 1));
                    } else {
                        this.collapseAll();
                    }

                    flyoutToAdd.element.addEventListener("keydown", this._handleKeyDownInCascade_bound, false);
                    this._cascadingStack.push(flyoutToAdd);
                },
                collapseFlyout: function _CascadeManager_collapseFlyout(flyout) {
                    // Removes flyout param and its subflyout descendants from the _cascadingStack.
                    if (!this.reentrancyLock && flyout && this.indexOf(flyout) >= 0) {
                        this.reentrancyLock = true;
                        var signal = new _Signal();
                        this.unlocked = signal.promise;

                        var subFlyout;
                        while (this.length && flyout !== subFlyout) {
                            subFlyout = this._cascadingStack.pop();
                            subFlyout.element.removeEventListener("keydown", this._handleKeyDownInCascade_bound, false);
                            subFlyout._hide(); // We use the reentrancyLock to prevent reentrancy here.
                        }

                        this.reentrancyLock = false;
                        this.unlocked = null;
                        signal.complete();
                    }
                },
                collapseAll: function _CascadeManager_collapseAll(keyboardInvoked) {
                    // Empties the _cascadingStack and hides all flyouts.
                    var headFlyout = this.getAt(0);
                    if (headFlyout) {
                        headFlyout._keyboardInvoked = keyboardInvoked;
                        this.collapseFlyout(headFlyout);
                    }
                },
                indexOf: function _CascadeManager_indexOf(flyout) {
                    return this._cascadingStack.indexOf(flyout);
                },
                indexOfElement: function _CascadeManager_indexOfElement(el) {
                    // Returns an index cooresponding to the Flyout in the cascade whose element contains the element in question.
                    // Returns -1 if the element is not contained by any Flyouts in the cascade.
                    var indexOfAssociatedFlyout = -1;
                    for (var i = 0, len = this.length; i < len; i++) {
                        var currentFlyout = this.getAt(i);
                        if (currentFlyout.element.contains(el)) {
                            indexOfAssociatedFlyout = i;
                            break;
                        }
                    }
                    return indexOfAssociatedFlyout;
                },
                length: {
                    get: function _CascadeManager_getLength() {
                        return this._cascadingStack.length;
                    }
                },
                getAt: function _CascadeManager_getAt(index) {
                    return this._cascadingStack[index];
                },
                handleFocusIntoFlyout: function _CascadeManager_handleFocusIntoFlyout(event) {
                    // When a flyout in the cascade recieves focus, we close all subflyouts beneath it.
                    var index = this.indexOfElement(event.target);
                    if (index >= 0) {
                        var subFlyout = this.getAt(index + 1);
                        this.collapseFlyout(subFlyout);
                    }
                },
                handleFocusOutOfCascade: function _CascadeManager_handleFocusOutOfCascade(event) {
                    // Hide the entire cascade if focus has moved somewhere outside of it
                    if (this.indexOfElement(event.relatedTarget) < 0) {
                        this.collapseAll();
                    }
                },
                _handleKeyDownInCascade: function _CascadeManager_handleKeyDownInCascade(event) {
                    var rtl = _Global.getComputedStyle(event.target).direction === "rtl",
                        leftKey = rtl ? Key.rightArrow : Key.leftArrow,
                        target = event.target;

                    if (event.keyCode === leftKey) {
                        // Left key press in a SubFlyout will close that subFlyout and any subFlyouts cascading from it.
                        var index = this.indexOfElement(target);
                        if (index >= 1) {
                            var subFlyout = this.getAt(index);
                            // Show a focus rect where focus is restored.
                            subFlyout._keyboardInvoked = true;
                            this.collapseFlyout(subFlyout);
                            // Prevent document scrolling
                            event.preventDefault();
                        }
                    } else if (event.keyCode === Key.alt || event.keyCode === Key.F10) {
                        // Show a focus rect where focus is restored.
                        this.collapseAll(true);
                    }
                },
            });

            var Flyout = _Base.Class.derive(_Overlay._Overlay, function Flyout_ctor(element, options) {
                /// <signature helpKeyword="WinJS.UI.Flyout.Flyout">
                /// <summary locid="WinJS.UI.Flyout.constructor">
                /// Creates a new Flyout control.
                /// </summary>
                /// <param name="element" type="HTMLElement" domElement="true" locid="WinJS.UI.Flyout.constructor_p:element">
                /// The DOM element that hosts the control.
                /// </param>
                /// <param name="options" type="Object" domElement="false" locid="WinJS.UI.Flyout.constructor_p:options">
                /// The set of properties and values to apply to the new Flyout.
                /// </param>
                /// <returns type="WinJS.UI.Flyout" locid="WinJS.UI.Flyout.constructor_returnValue">The new Flyout control.</returns>
                /// <compatibleWith platform="Windows" minVersion="8.0"/>
                /// </signature>

                // Simplify checking later
                options = options || {};

                // Make sure there's an input element
                this._element = element || _Global.document.createElement("div");
                this._id = this._element.id || _ElementUtilities._uniqueID(this._element);
                this._writeProfilerMark("constructor,StartTM");

                this._baseFlyoutConstructor(this._element, options);

                var _elms = this._element.getElementsByTagName("*");
                var firstDiv = this._addFirstDiv();
                firstDiv.tabIndex = _ElementUtilities._getLowestTabIndexInList(_elms);
                var finalDiv = this._addFinalDiv();
                finalDiv.tabIndex = _ElementUtilities._getHighestTabIndexInList(_elms);

                // Handle "esc" & "tab" key presses
                this._element.addEventListener("keydown", this._handleKeyDown, true);

                this._writeProfilerMark("constructor,StopTM");
                return this;
            }, {
                _lastMaxHeight: null,

                _baseFlyoutConstructor: function Flyout_baseFlyoutContstructor(element, options) {
                    // Flyout constructor

                    // We have some options with defaults
                    this._placement = "auto";
                    this._alignment = "center";

                    // Call the base overlay constructor helper
                    this._baseOverlayConstructor(element, options);

                    // Make a click eating div
                    _Overlay._Overlay._createClickEatingDivFlyout();

                    // Start flyouts hidden
                    this._element.style.visibilty = "hidden";
                    this._element.style.display = "none";

                    // Attach our css class
                    _ElementUtilities.addClass(this._element, _Constants.flyoutClass);

                    // Make sure we have an ARIA role
                    var role = this._element.getAttribute("role");
                    if (role === null || role === "" || role === undefined) {
                        if (_ElementUtilities.hasClass(this._element, _Constants.menuClass)) {
                            this._element.setAttribute("role", "menu");
                        } else {
                            this._element.setAttribute("role", "dialog");
                        }
                    }
                    var label = this._element.getAttribute("aria-label");
                    if (label === null || label === "" || label === undefined) {
                        this._element.setAttribute("aria-label", strings.ariaLabel);
                    }

                    // Base animation is popIn, but our flyout has different arguments
                    this._currentAnimateIn = this._flyoutAnimateIn;
                    this._currentAnimateOut = this._flyoutAnimateOut;

                    _ElementUtilities._addEventListener(this.element, "focusin", this._handleFocusIn.bind(this), false);
                    _ElementUtilities._addEventListener(this.element, "focusout", this._handleFocusOut.bind(this), false);

                    // Make sure additional _Overlay event handlers are hooked up
                    this._handleOverlayEventsForFlyoutOrSettingsFlyout();
                },

                /// <field type="String" locid="WinJS.UI.Flyout.anchor" helpKeyword="WinJS.UI.Flyout.anchor">
                /// Gets or sets the Flyout control's anchor. The anchor element is the HTML element which the Flyout originates from and is positioned relative to.
                /// (This setting can be overridden when you call the show method.)
                /// <compatibleWith platform="Windows" minVersion="8.0"/>
                /// </field>
                anchor: {
                    get: function () {
                        return this._anchor;
                    },
                    set: function (value) {
                        this._anchor = value;
                    }
                },

                /// <field type="String" defaultValue="auto" oamOptionsDatatype="WinJS.UI.Flyout.placement" locid="WinJS.UI.Flyout.placement" helpKeyword="WinJS.UI.Flyout.placement">
                /// Gets or sets the default placement of this Flyout. (This setting can be overridden when you call the show method.)
                /// <compatibleWith platform="Windows" minVersion="8.0"/>
                /// </field>
                placement: {
                    get: function () {
                        return this._placement;
                    },
                    set: function (value) {
                        if (value !== "top" && value !== "bottom" && value !== "left" && value !== "right" && value !== "auto" && value !== "autohorizontal" && value !== "autovertical") {
                            // Not a legal placement value
                            throw new _ErrorFromName("WinJS.UI.Flyout.BadPlacement", strings.badPlacement);
                        }
                        this._placement = value;
                    }
                },

                /// <field type="String" defaultValue="center" oamOptionsDatatype="WinJS.UI.Flyout.alignment" locid="WinJS.UI.Flyout.alignment" helpKeyword="WinJS.UI.Flyout.alignment">
                /// Gets or sets the default alignment for this Flyout. (This setting can be overridden when you call the show method.)
                /// <compatibleWith platform="Windows" minVersion="8.0"/>
                /// </field>
                alignment: {
                    get: function () {
                        return this._alignment;
                    },
                    set: function (value) {
                        if (value !== "right" && value !== "left" && value !== "center") {
                            // Not a legal alignment value
                            throw new _ErrorFromName("WinJS.UI.Flyout.BadAlignment", strings.badAlignment);
                        }
                        this._alignment = value;
                    }
                },

                /// <field type="Boolean" locid="WinJS.UI.Flyout.disabled" helpKeyword="WinJS.UI.Flyout.disabled">Disable a Flyout, setting or getting the HTML disabled attribute.  When disabled the Flyout will no longer display with show(), and will hide if currently visible.</field>
                disabled: {
                    get: function () {
                        // Ensure it's a boolean because we're using the DOM element to keep in-sync
                        return !!this._element.disabled;
                    },
                    set: function (value) {
                        // Force this check into a boolean because our current state could be a bit confused since we tie to the DOM element
                        value = !!value;
                        var oldValue = !!this._element.disabled;
                        if (oldValue !== value) {
                            this._element.disabled = value;
                            if (!this.hidden && this._element.disabled) {
                                this.hide();
                            }
                        }
                    }
                },

                /// <field type="Function" locid="WinJS.UI.Flyout.onbeforeshow" helpKeyword="WinJS.UI.Flyout.onbeforeshow">
                /// Occurs immediately before the control is shown.
                /// </field>
                onbeforeshow: createEvent(_Overlay._Overlay.beforeShow),

                /// <field type="Function" locid="WinJS.UI.Flyout.onaftershow" helpKeyword="WinJS.UI.Flyout.onaftershow">
                /// Occurs immediately after the control is shown.
                /// </field>
                onaftershow: createEvent(_Overlay._Overlay.afterShow),

                /// <field type="Function" locid="WinJS.UI.Flyout.onbeforehide" helpKeyword="WinJS.UI.Flyout.onbeforehide">
                /// Occurs immediately before the control is hidden.
                /// </field>
                onbeforehide: createEvent(_Overlay._Overlay.beforeHide),

                /// <field type="Function" locid="WinJS.UI.Flyout.onafterhide" helpKeyword="WinJS.UI.Flyout.onafterhide">
                /// Occurs immediately after the control is hidden.
                /// </field>
                onafterhide: createEvent(_Overlay._Overlay.afterHide),

                _dispose: function Flyout_dispose() {
                    _Dispose.disposeSubTree(this.element);
                    this._hide();
                    this.anchor = null;
                },

                show: function (anchor, placement, alignment) {
                    /// <signature helpKeyword="WinJS.UI.Flyout.show">
                    /// <summary locid="WinJS.UI.Flyout.show">
                    /// Shows the Flyout, if hidden, regardless of other states.
                    /// </summary>
                    /// <param name="anchor" type="HTMLElement" domElement="true" locid="WinJS.UI.Flyout.show_p:anchor">
                    /// The DOM element, or ID of a DOM element to anchor the Flyout, overriding the anchor property for this time only.
                    /// </param>
                    /// <param name="placement" type="Object" domElement="false" locid="WinJS.UI.Flyout.show_p:placement">
                    /// The placement of the Flyout to the anchor: 'auto' (default), 'top', 'bottom', 'left', or 'right'.  This parameter overrides the placement property for this show only.
                    /// </param>
                    /// <param name="alignment" type="Object" domElement="false" locid="WinJS.UI.Flyout.show:alignment">
                    /// For 'top' or 'bottom' placement, the alignment of the Flyout to the anchor's edge: 'center' (default), 'left', or 'right'.
                    /// This parameter overrides the alignment property for this show only.
                    /// </param>
                    /// <compatibleWith platform="Windows" minVersion="8.0"/>
                    /// </signature>
                    this._writeProfilerMark("show,StartTM"); // The corresponding "stop" profiler mark is handled in _Overlay._baseEndShow().
                    this._show(anchor, placement, alignment);
                },

                _show: function Flyout_show(anchor, placement, alignment, coordinates) {
                    this._baseFlyoutShow(anchor, placement, alignment, null);
                },

                /// <signature helpKeyword="WinJS.UI.Flyout.showAt">
                /// <summary locid="WinJS.UI.Flyout.showAt">
                /// Shows the Flyout, if hidden, at the specified (x,y) coordinates.
                /// </summary>
                /// <param name="coordinates" type="Object" domElement="false" locid="WinJS.UI.Flyout.showAt_p:coordinates">
                /// The point at which to draw the Flyout, relative to the visual viewport.
                /// Acceptible values are PointerEvent Objects, MouseEvent Objects and generic objects that define properties 'x' and 'y'.
                /// </param>
                /// <param name="placement" type="Object" domElement="false" locid="WinJS.UI.Flyout.show_p:placement">
                /// The placement of the Flyout to the anchor: 'auto' (default), 'top', 'bottom', 'left', or 'right'.  This parameter overrides the placement property for this show only.
                /// </param>
                /// <param name="alignment" type="Object" domElement="false" locid="WinJS.UI.Flyout.show:alignment">
                /// For 'top' or 'bottom' placement, the alignment of the Flyout to the anchor's edge: 'center' (default), 'left', or 'right'.
                /// This parameter overrides the alignment property for this show only.
                /// </param>
                /// <compatibleWith platform="Windows" minVersion="8.0"/>
                /// </signature>
                showAt: function Flyout_showAt(coordinates) {
                    this._writeProfilerMark("show,StartTM"); // The corresponding "stop" profiler mark is handled in _Overlay._baseEndShow().
                    this._showAt(coordinates);
                },

                _showAt: function Flyout_show(coordinates) {
                    this._baseFlyoutShow(null, "cartesian", "none", coordinates);
                },

                hide: function () {
                    /// <signature helpKeyword="WinJS.UI.Flyout.hide">
                    /// <summary locid="WinJS.UI.Flyout.hide">
                    /// Hides the Flyout, if visible, regardless of other states.
                    /// </summary>
                    /// <compatibleWith platform="Windows" minVersion="8.0"/>
                    /// </signature>
                    // Just wrap the private one, turning off keyboard invoked flag
                    this._writeProfilerMark("hide,StartTM"); // The corresponding "stop" profiler mark is handled in _Overlay._baseEndHide().
                    this._keyboardInvoked = false;
                    this._hide();
                },

                _hide: function Flyout_hide() {

                    // First close all subflyout descendants in the cascade.
                    // Any calls to collapseFlyout through reentrancy should nop.
                    Flyout._cascadeManager.collapseFlyout(this);

                    if (this._baseHide()) {
                        // Return focus if this or the flyout CED has focus
                        var active = _Global.document.activeElement;
                        if (this._previousFocus
                           && active
                           && (this._element.contains(active)
                               || _ElementUtilities.hasClass(active, _Overlay._Overlay._clickEatingFlyoutClass))
                           && this._previousFocus.focus !== undefined) {

                            // _isAppBarOrChild may return a CED or sentinal
                            var appBar = _Overlay._Overlay._isAppBarOrChild(this._previousFocus);
                            if (!appBar || (appBar.winControl && appBar.winControl.opened && !appBar.winAnimating)) {
                                // Don't move focus back to a appBar that is hidden
                                // We cannot rely on element.style.visibility because it will be visible while animating
                                var role = this._previousFocus.getAttribute("role");
                                var fHideRole = _Overlay._Overlay._keyboardInfo._visible && !this._keyboardWasUp;
                                if (fHideRole) {
                                    // Convince IHM to dismiss because it only came up after the flyout was up.
                                    // Change aria role and back to get IHM to dismiss.
                                    this._previousFocus.setAttribute("role", "");
                                }

                                if (this._keyboardInvoked) {
                                    this._previousFocus.focus();
                                } else {
                                    _Overlay._Overlay._trySetActive(this._previousFocus);
                                }
                                active = _Global.document.activeElement;

                                if (fHideRole) {
                                    // Restore the role so that css is applied correctly
                                    var previousFocus = this._previousFocus;
                                    if (previousFocus) {
                                        _BaseUtils._yieldForDomModification(function () {
                                            previousFocus.setAttribute("role", role);
                                        });
                                    }
                                }
                            }
                        }

                        this._previousFocus = null;

                        // Need click-eating div to be hidden if there are no other visible flyouts
                        if (!this._isThereVisibleFlyout()) {
                            _Overlay._Overlay._hideClickEatingDivFlyout();
                        }
                    }
                },

                _baseFlyoutShow: function Flyout_baseFlyoutShow(anchor, placement, alignment, coordinates) {
                    // Don't do anything if disabled
                    if (this.disabled) {
                        return;
                    }

                    // Store the function call with the parameters used to "show" the flyout so that we can repeat
                    // the operation later if something forces us to cancel and resume later.
                    var that = this;
                    this._currentShowFn = function () { that._baseFlyoutShow(anchor, placement, alignment, coordinates); };

                    if (coordinates) {
                        // If we are showing via arbitrary coordinates, then we don't require an anchor to show
                        // ourselves. If an anchor hasn't been assigned just use the body.
                        anchor = anchor || this._anchor || document.body;

                        placement = "cartesian";
                        alignment = "none";

                        // Normalize coordinates since they could be a mouse/pointer event object or an (x,y) pair.
                        var temp = coordinates;
                        coordinates = {
                            x: temp.clientX || temp.x,
                            y: temp.clientY || temp.y
                        };
                    } else {
                        // Else we are showing relative to our anchor element. Anchor element is required.

                        // Pick up defaults
                        if (!anchor) {
                            anchor = this._anchor;
                        }
                        if (!placement) {
                            placement = this._placement;
                        }
                        if (!alignment) {
                            alignment = this._alignment;
                        }

                        // Dereference the anchor if necessary
                        if (typeof anchor === "string") {
                            anchor = _Global.document.getElementById(anchor);
                        } else if (anchor && anchor.element) {
                            anchor = anchor.element;
                        }

                        if (!anchor) {
                            // We expect an anchor
                            throw new _ErrorFromName("WinJS.UI.Flyout.NoAnchor", strings.noAnchor);
                        }
                    }

                    // Remember current values in case we need to stop and resume.
                    this._currentAnchor = anchor;
                    this._currentPlacement = placement;
                    this._currentAlignment = alignment;
                    this._currentCoordinates = coordinates;

                    // Need click-eating div to be visible, no matter what
                    if (!this._sticky) {
                        _Overlay._Overlay._showClickEatingDivFlyout();
                    }

                    // If we're animating (eg baseShow is going to fail), or the cascadeManager is in the middle of 
                    // updating the cascade, then don't mess up our current state.
                    if (this._element.winAnimating) {
                        // Queue us up to wait for the current animation to finish.
                        // _checkDoNext() is always scheduled after the current animation completes.
                        this._doNext = "show";
                    } else if (Flyout._cascadeManager.reentrancyLock) {
                        // Queue us up to wait for the current animation to finish.
                        // Schedule a call to _checkDoNext() for when the cascadeManager unlocks.
                        this._doNext = "show";
                        var that = this;
                        Flyout._cascadeManager.unlocked.then(function () { that._checkDoNext(); });
                    } else {
                        // We call our base _baseShow to handle the actual animation
                        if (this._baseShow()) {
                            // (_baseShow shouldn't ever fail because we tested winAnimating above).
                            if (!_ElementUtilities.hasClass(this.element, "win-menu")) {
                                // Verify that the firstDiv is in the correct location.
                                // Move it to the correct location or add it if not.
                                var _elms = this._element.getElementsByTagName("*");
                                var firstDiv = this.element.querySelectorAll(".win-first");
                                if (this.element.children.length && !_ElementUtilities.hasClass(this.element.children[0], _Constants.firstDivClass)) {
                                    if (firstDiv && firstDiv.length > 0) {
                                        firstDiv.item(0).parentNode.removeChild(firstDiv.item(0));
                                    }

                                    firstDiv = this._addFirstDiv();
                                }
                                firstDiv.tabIndex = _ElementUtilities._getLowestTabIndexInList(_elms);

                                // Verify that the finalDiv is in the correct location.
                                // Move it to the correct location or add it if not.
                                var finalDiv = this.element.querySelectorAll(".win-final");
                                if (!_ElementUtilities.hasClass(this.element.children[this.element.children.length - 1], _Constants.finalDivClass)) {
                                    if (finalDiv && finalDiv.length > 0) {
                                        finalDiv.item(0).parentNode.removeChild(finalDiv.item(0));
                                    }

                                    finalDiv = this._addFinalDiv();
                                }
                                finalDiv.tabIndex = _ElementUtilities._getHighestTabIndexInList(_elms);
                            }

                            Flyout._cascadeManager.appendFlyout(this);

                            // Store what had focus before showing the Flyout. This must happen after we've appended this
                            // Flyout to the cascade and subsequently triggered other branches of cascading flyouts to
                            // collapse. Ensures that focus has already been restored to the correct element by the
                            // previous branch before we try to record it here.
                            this._previousFocus = _Global.document.activeElement;

                            if (!_ElementUtilities.hasClass(this.element, _Constants.menuClass)) {
                                // Put focus on the first child in the Flyout
                                this._focusOnFirstFocusableElementOrThis();
                            } else {
                                // Make sure the menu has focus, but don't show a focus rect
                                _Overlay._Overlay._trySetActive(this._element);
                            }
                        }
                    }
                },

                _endShow: function Flyout_endShow() {
                    // Remember if the IHM was up since we may need to hide it when the flyout hides.
                    // This check needs to happen after we've hidden any other visible flyouts from
                    // the cascasde as a result of showing this flyout.
                    this._keyboardWasUp = _Overlay._Overlay._keyboardInfo._visible;
                },

                _isLightDismissible: function Flyout_isLightDismissible() {
                    return (!this.hidden);
                },

                _lightDismiss: function Flyout_lightDismiss() {
                    Flyout._cascadeManager.collapseAll();
                },

                // Find our new flyout position.
                _findPosition: function Flyout_findPosition() {
                    //this._nextMaxHeight = null;
                    this._adjustedHeight = 0;
                    this._nextTop = 0;
                    this._nextLeft = 0;
                    this._keyboardMovedUs = false;

                    // Make sure menu commands display correctly
                    if (this._checkMenuCommands) {
                        this._checkMenuCommands();
                    }

                    // Remove old height restrictions and scrolling
                    this._clearAdjustedStyles();

                    this._setAlignment(this._currentAlignment);

                    // Set up the new position, and prep the offset for showPopup
                    this._getTopLeft();

                    // Adjust position
                    if (this._nextTop < 0) {
                        // Overran bottom, attach to bottom.
                        this._element.style.bottom = _Overlay._Overlay._keyboardInfo._visibleDocBottomOffset + "px";
                        this._element.style.top = "auto";
                    } else {
                        // Normal, set top
                        this._element.style.top = this._nextTop + "px";
                        this._element.style.bottom = "auto";
                    }
                    if (this._nextLeft < 0) {
                        // Overran right, attach to right
                        this._element.style.right = _Overlay._Overlay._keyboardInfo._visualViewportWidth + "px";
                        this._element.style.left = "auto";
                    } else {
                        // Normal, set left
                        this._element.style.left = this._nextLeft + "px";
                        this._element.style.right = "auto";
                    }

                    // Adjust height/scrollbar
                    if (this._needsScrolls) {
                        _ElementUtilities.addClass(this._element, _Constants.scrollsClass);
                        this._lastMaxHeight = this._element.style.maxHeight;
                        this._element.style.maxHeight = this._adjustedHeight + "px";
                    }

                    // May need to adjust if the IHM is showing.
                    if (_Overlay._Overlay._keyboardInfo._visible) {
                        // Use keyboard logic
                        this._checkKeyboardFit();

                        if (this._keyboardMovedUs) {
                            this._adjustForKeyboard();
                        }
                    }
                },

                // This determines our positioning.  We have 7 modes, the 1st four are explicit, the last three are automatic:
                // * top - position explicitly on the top of the anchor, shrinking and adding scrollbar as needed.
                // * bottom - position explicitly below the anchor, shrinking and adding scrollbar as needed.
                // * left - position left of the anchor, shrinking and adding a vertical scrollbar as needed.
                // * right - position right of the anchor, shrinking and adding a vertical scroolbar as needed.
                // * auto - Automatic placement.
                // * autohorizontal - Automatic placement (only left or right).
                // * autovertical - Automatic placement (only top or bottom).
                // Auto tests the height of the anchor and the flyout.  For consistency in orientation, we imagine
                // that the anchor is placed in the vertical center of the display.  If the flyout would fit above
                // that centered anchor, then we will place the flyout vertically in relation to the anchor, otherwise
                // placement will be horizontal.
                // Vertical auto or autovertical placement will be positioned on top of the anchor if room, otherwise below the anchor.
                //   - this is because touch users would be more likely to obscure flyouts below the anchor.
                // Horizontal auto or autohorizontal placement will be positioned to the left of the anchor if room, otherwise to the right.
                //   - this is because right handed users would be more likely to obscure a flyout on the right of the anchor.
                // All three auto placements will add a vertical scrollbar if necessary.
                _getTopLeft: function Flyout_getTopLeft() {

                    var that = this;

                    function configureVerticalWithScroll(anchor) {
                        // Won't fit top or bottom. Pick the one with the most space and add a scrollbar.
                        if (topHasMoreRoom(anchor)) {
                            // Top
                            that._nextTop = _Overlay._Overlay._keyboardInfo._visibleDocTop;
                            that._adjustedHeight = anchor.top - _Overlay._Overlay._keyboardInfo._visibleDocTop - that._cachedMarginBorderPadding;
                        } else {
                            // Bottom
                            that._nextTop = -1;
                            that._adjustedHeight = _Overlay._Overlay._keyboardInfo._visibleDocHeight - (anchor.bottom - _Overlay._Overlay._keyboardInfo._visibleDocTop) - that._cachedMarginBorderPadding;
                        }
                        that._needsScrolls = true;
                    }

                    // If the anchor is centered vertically, would the flyout fit above it?
                    function sometimesFitsAbove(anchor, flyout) {
                        return ((_Overlay._Overlay._keyboardInfo._visibleDocHeight - anchor.height) / 2) >= flyout.height;
                    }

                    function topHasMoreRoom(anchor) {
                        return anchor.top > _Overlay._Overlay._keyboardInfo._visibleDocHeight - anchor.bottom;
                    }

                    // See if we can fit in various places, fitting in the main view,
                    // ignoring viewport changes, like for the IHM.
                    function fitTop(anchor, flyout) {
                        that._nextTop = anchor.top - flyout.height;
                        that._nextAnimOffset = { top: "50px", left: "0px", keyframe: "WinJS-showFlyoutTop" };
                        return (that._nextTop >= _Overlay._Overlay._keyboardInfo._visibleDocTop &&
                                that._nextTop + flyout.height <= _Overlay._Overlay._keyboardInfo._visibleDocBottom);
                    }

                    function fitBottom(anchor, flyout) {
                        that._nextTop = anchor.bottom;
                        that._nextAnimOffset = { top: "-50px", left: "0px", keyframe: "WinJS-showFlyoutBottom" };
                        return (that._nextTop >= _Overlay._Overlay._keyboardInfo._visibleDocTop &&
                                that._nextTop + flyout.height <= _Overlay._Overlay._keyboardInfo._visibleDocBottom);
                    }

                    function fitLeft(anchor, flyout) {
                        that._nextLeft = anchor.left - flyout.width;
                        that._nextAnimOffset = { top: "0px", left: "50px", keyframe: "WinJS-showFlyoutLeft" };
                        return (that._nextLeft >= 0 && that._nextLeft + flyout.width <= _Overlay._Overlay._keyboardInfo._visualViewportWidth);
                    }

                    function fitRight(anchor, flyout) {
                        that._nextLeft = anchor.right;
                        that._nextAnimOffset = { top: "0px", left: "-50px", keyframe: "WinJS-showFlyoutRight" };
                        return (that._nextLeft >= 0 && that._nextLeft + flyout.width <= _Overlay._Overlay._keyboardInfo._visualViewportWidth);
                    }

                    function centerVertically(anchor, flyout) {
                        that._nextTop = anchor.top + anchor.height / 2 - flyout.height / 2;
                        if (that._nextTop < _Overlay._Overlay._keyboardInfo._visibleDocTop) {
                            that._nextTop = _Overlay._Overlay._keyboardInfo._visibleDocTop;
                        } else if (that._nextTop + flyout.height >= _Overlay._Overlay._keyboardInfo._visibleDocBottom) {
                            // Flag to put on bottom
                            that._nextTop = -1;
                        }
                    }

                    function centerHorizontally(anchor, flyout, alignment) {
                        if (alignment === "center") {
                            that._nextLeft = anchor.left + anchor.width / 2 - flyout.width / 2;
                        } else if (alignment === "left") {
                            that._nextLeft = anchor.left;
                        } else if (alignment === "right") {
                            that._nextLeft = anchor.right - flyout.width;
                        } else {
                            throw new _ErrorFromName("WinJS.UI.Flyout.BadAlignment", strings.badAlignment);
                        }
                        if (that._nextLeft < 0) {
                            that._nextLeft = 0;
                        } else if (that._nextLeft + flyout.width >= _Global.document.documentElement.clientWidth) {
                            // flag to put on right
                            that._nextLeft = -1;
                        }
                    }

                    var anchorRawRectangle,
                        flyout = {},
                        anchor = {};

                    try {
                        anchorRawRectangle = this._currentAnchor.getBoundingClientRect();
                    }
                    catch (e) {
                        throw new _ErrorFromName("WinJS.UI.Flyout.NoAnchor", strings.noAnchor);
                    }

                    // Adjust for the anchor's margins.
                    anchor.top = anchorRawRectangle.top;
                    anchor.bottom = anchorRawRectangle.bottom;
                    anchor.left = anchorRawRectangle.left;
                    anchor.right = anchorRawRectangle.right;
                    anchor.height = anchor.bottom - anchor.top;
                    anchor.width = anchor.right - anchor.left;

                    // Get our flyout and margins, note that getDimension calls
                    // window.getComputedStyle, which ensures layout is updated.
                    flyout.marginTop = getDimension(this._element, "marginTop");
                    flyout.marginBottom = getDimension(this._element, "marginBottom");
                    flyout.marginLeft = getDimension(this._element, "marginLeft");
                    flyout.marginRight = getDimension(this._element, "marginRight");
                    flyout.width = _ElementUtilities.getTotalWidth(this._element);
                    flyout.height = _ElementUtilities.getTotalHeight(this._element);
                    flyout.innerWidth = _ElementUtilities.getContentWidth(this._element);
                    flyout.innerHeight = _ElementUtilities.getContentHeight(this._element);
                    this._cachedMarginBorderPadding = (flyout.height - flyout.innerHeight);
                    this._adjustedHeight = flyout.innerHeight;

                    // Check fit for requested this._currentPlacement, doing fallback if necessary
                    switch (this._currentPlacement) {
                        case "top":
                            if (!fitTop(anchor, flyout)) {
                                // Didn't fit, needs scrollbar
                                this._nextTop = _Overlay._Overlay._keyboardInfo._visibleDocTop;
                                this._needsScrolls = true;
                                this._adjustedHeight = anchor.top - _Overlay._Overlay._keyboardInfo._visibleDocTop - this._cachedMarginBorderPadding;
                            }
                            centerHorizontally(anchor, flyout, this._currentAlignment);
                            break;
                        case "bottom":
                            if (!fitBottom(anchor, flyout)) {
                                // Didn't fit, needs scrollbar
                                this._nextTop = -1;
                                this._needsScrolls = true;
                                this._adjustedHeight = _Overlay._Overlay._keyboardInfo._visibleDocHeight - (anchor.bottom - _Overlay._Overlay._keyboardInfo._visibleDocTop) - this._cachedMarginBorderPadding;
                            }
                            centerHorizontally(anchor, flyout, this._currentAlignment);
                            break;
                        case "left":
                            if (!fitLeft(anchor, flyout)) {
                                // Didn't fit, just shove it to edge
                                this._nextLeft = 0;
                            }
                            centerVertically(anchor, flyout);
                            break;
                        case "right":
                            if (!fitRight(anchor, flyout)) {
                                // Didn't fit,just shove it to edge
                                this._nextLeft = -1;
                            }
                            centerVertically(anchor, flyout);
                            break;
                        case "autovertical":
                            if (!fitTop(anchor, flyout)) {
                                // Didn't fit above (preferred), so go below.
                                if (!fitBottom(anchor, flyout)) {
                                    // Didn't fit, needs scrollbar
                                    configureVerticalWithScroll(anchor);
                                }
                            }
                            centerHorizontally(anchor, flyout, this._currentAlignment);
                            break;
                        case "autohorizontal":
                            if (!fitLeft(anchor, flyout)) {
                                // Didn't fit left (preferred), so go right.
                                if (!fitRight(anchor, flyout)) {
                                    // Didn't fit,just shove it to edge
                                    this._nextLeft = -1;
                                }
                            }
                            centerVertically(anchor, flyout);
                            break;
                        case "auto":
                            // Auto, if the anchor was in the vertical center of the display would we fit above it?
                            if (sometimesFitsAbove(anchor, flyout)) {
                                // It will fit above or below the anchor
                                if (!fitTop(anchor, flyout)) {
                                    // Didn't fit above (preferred), so go below.
                                    fitBottom(anchor, flyout);
                                }
                                centerHorizontally(anchor, flyout, this._currentAlignment);
                            } else {
                                // Won't fit above or below, try a side
                                if (!fitLeft(anchor, flyout) &&
                                    !fitRight(anchor, flyout)) {
                                    // Didn't fit left or right either
                                    configureVerticalWithScroll(anchor);
                                    centerHorizontally(anchor, flyout, this._currentAlignment);
                                } else {
                                    centerVertically(anchor, flyout);
                                }
                            }
                            break;
                        default:
                            // Not a legal this._currentPlacement value
                            throw new _ErrorFromName("WinJS.UI.Flyout.BadPlacement", strings.badPlacement);
                    }
                },

                _clearAdjustedStyles: function Flyout_clearAdjustedStyles() {
                    // Move to 0,0 in case it is off screen, so that it lays out at a reasonable size
                    this._element.style.top = "0px";
                    this._element.style.bottom = "auto";
                    this._element.style.left = "0px";
                    this._element.style.right = "auto";

                    // Clear height restrictons and scrollbar class
                    _ElementUtilities.removeClass(this._element, _Constants.scrollsClass);
                    if (this._lastMaxHeight !== null) {
                        this._element.style.maxHeight = this._lastMaxHeight;
                        this._lastMaxHeight = null;
                    };

                    // Clear Alignment
                    _ElementUtilities.removeClass(this._element, "win-rightalign");
                    _ElementUtilities.removeClass(this._element, "win-leftalign");
                },

                _setAlignment: function Flyout_setAlignment(alignment) {
                    // Alignment
                    switch (alignment) {
                        case "left":
                            _ElementUtilities.addClass(this._element, "win-leftalign");
                            break;
                        case "right":
                            _ElementUtilities.addClass(this._element, "win-rightalign");
                            break;
                        case "center":
                            break;
                    };
                },

                _showingKeyboard: function Flyout_showingKeyboard(event) {
                    if (this.hidden) {
                        return;
                    }

                    // The only way that we can be showing a keyboard when a flyout is up is because the input was
                    // in the flyout itself, in which case we'll be moving ourselves.  There is no practical way
                    // for the application to override this as the focused element is in our flyout.
                    event.ensuredFocusedElementInView = true;

                    // See if the keyboard is going to force us to move
                    this._checkKeyboardFit();

                    if (this._keyboardMovedUs) {
                        // Pop out immediately, then move to new spot
                        this._element.style.opacity = 0;
                        var that = this;
                        _Global.setTimeout(function () { that._adjustForKeyboard(); that._baseAnimateIn(); }, _Overlay._Overlay._keyboardInfo._animationShowLength);
                    }
                },

                _resize: function Flyout_resize() {
                    // If hidden and not busy animating, then nothing to do
                    if (!this.hidden || this._animating) {

                        // This should only happen if the IHM is dismissing,
                        // the only other way is for viewstate changes, which
                        // would dismiss any flyout.
                        if (this._needToHandleHidingKeyboard) {
                            // Hiding keyboard, update our position, giving the anchor a chance to update first.
                            var that = this;
                            _BaseUtils._setImmediate(function () {
                                if (!that.hidden || that._animating) {
                                    that._findPosition();
                                }
                            });
                            this._needToHandleHidingKeyboard = false;
                        }
                    }
                },

                // If you were not pinned to the bottom, you might have to be now. I only need this for IHM, any maybe not even then..
                _checkKeyboardFit: function Flyout_checkKeyboardFit() {
                    // Special Flyout positioning rules to determine if the Flyout needs to adjust its
                    // position because of the IHM. If the Flyout needs to adjust for the IHM,it will reposition
                    // itself to be pinned to either the top or bottom edge of the visual viewport.
                    // - Too Tall, above top, or below bottom.
                    
                    var keyboardMovedUs = false;
                    var viewportHeight = _Overlay._Overlay._keyboardInfo._visibleDocHeight;
                    var adjustedMarginBoxHeight = this._adjustedHeight + this._cachedMarginBorderPadding;
                    if (adjustedMarginBoxHeight > viewportHeight) {
                        // The Flyout is now too tall to fit in the viewport, pin to top and adjust height.
                        keyboardMovedUs = true;
                        this._nextTop = -1;
                        this._adjustedHeight = viewportHeight;
                        this._needsScrolls = true;
                    } else if (this._nextTop >= 0 &&
                        this._nextTop + adjustedMarginBoxHeight > _Overlay._Overlay._keyboardInfo._visibleDocBottom) {
                        // Flyout clips the bottom of the viewport. Pin to bottom.
                        this._nextTop = -1;
                        keyboardMovedUs = true;
                    } else if (this._nextTop === -1) {
                        // We were already pinned to the bottom, so our position on screen will change
                        _keyboardMovedUs = true;
                    }

                    // Signals use of basic fadein animation
                    this._keyboardMovedUs = keyboardMovedUs;
                },

                _adjustForKeyboard: function Flyout_adjustForKeyboard() {
                    // Keyboard moved us, update our metrics as needed
                    if (this._needsScrolls) {
                        // Add scrollbar if we didn't already have scrollsClass
                        if (!this._lastMaxHeight) {
                            _ElementUtilities.addClass(this._element, _Constants.scrollsClass);
                            this._lastMaxHeight = this._element.style.maxHeight;
                        }
                        // Adjust height
                        this._element.style.maxHeight = this._adjustedHeight + "px";
                    }

                    // Update top/bottom
                    this._checkScrollPosition(true);
                },

                _hidingKeyboard: function Flyout_hidingKeyboard() {
                    // If we aren't visible and not animating, or haven't been repositioned, then nothing to do
                    // We don't know if the keyboard moved the anchor, so _keyboardMovedUs doesn't help here
                    if (!this.hidden || this._animating) {

                        // Snap to the final position
                        // We'll either just reveal the current space or resize the window
                        if (_Overlay._Overlay._keyboardInfo._isResized) {
                            // Flag resize that we'll need an updated position
                            this._needToHandleHidingKeyboard = true;
                        } else {
                            // Not resized, update our final position, giving the anchor a chance to update first.
                            var that = this;
                            _BaseUtils._setImmediate(function () {
                                if (!that.hidden || that._animating) {
                                    that._findPosition();
                                }
                            });
                        }
                    }
                },

                // Rename to updatePosition
                _checkScrollPosition: function Flyout_checkScrollPosition(showing) {
                    if (this.hidden && !showing) {
                        return;
                    }

                    // May need to adjust top by viewport offset
                    if (this._nextTop === -1) {
                        // Need to attach to bottom
                        this._element.style.bottom = _Overlay._Overlay._keyboardInfo._visibleDocBottomOffset + "px";
                        this._element.style.top = "auto";
                    } else {
                        // Normal, attach to top
                        this._element.style.top = this._nextTop + "px";
                        this._element.style.bottom = "auto";
                    }
                },

                // AppBar flyout animations
                _flyoutAnimateIn: function Flyout_flyoutAnimateIn() {
                    if (this._keyboardMovedUs) {
                        return this._baseAnimateIn();
                    } else {
                        this._element.style.opacity = 1;
                        this._element.style.visibility = "visible";
                        return Animations.showPopup(this._element, this._nextAnimOffset);
                    }
                },

                _flyoutAnimateOut: function Flyout_flyoutAnimateOut() {
                    if (this._keyboardMovedUs) {
                        return this._baseAnimateOut();
                    } else {
                        this._element.style.opacity = 0;
                        return Animations.hidePopup(this._element, this._nextAnimOffset);
                    }
                },

                // Hide all other flyouts besides this one
                _hideAllOtherFlyouts: function Flyout_hideAllOtherFlyouts(thisFlyout) {
                    var flyouts = _Global.document.querySelectorAll("." + _Constants.flyoutClass);
                    for (var i = 0; i < flyouts.length; i++) {
                        var flyoutControl = flyouts[i].winControl;
                        if (flyoutControl && !flyoutControl.hidden && (flyoutControl !== thisFlyout)) {
                            flyoutControl.hide();
                        }
                    }
                },

                // Returns true if there is a flyout in the DOM that is not hidden
                _isThereVisibleFlyout: function Flyout_isThereVisibleFlyout() {
                    var flyouts = _Global.document.querySelectorAll("." + _Constants.flyoutClass);
                    for (var i = 0; i < flyouts.length; i++) {
                        var flyoutControl = flyouts[i].winControl;
                        if (flyoutControl && !flyoutControl.hidden) {
                            return true;
                        }
                    }

                    return false;
                },

                _handleKeyDown: function Flyout_handleKeyDown(event) {
                    // Escape closes flyouts but if the user has a text box with an IME candidate
                    // window open, we want to skip the ESC key event since it is handled by the IME.
                    // When the IME handles a key it sets event.keyCode === Key.IME for an easy check.
                    if (event.keyCode === Key.escape && event.keyCode !== Key.IME) {
                        // Show a focus rect on what we move focus to
                        event.preventDefault();
                        event.stopPropagation();
                        this.winControl._keyboardInvoked = true;
                        this.winControl._hide();
                    } else if ((event.keyCode === Key.space || event.keyCode === Key.enter)
                         && (this === _Global.document.activeElement)) {
                        event.preventDefault();
                        event.stopPropagation();
                        this.winControl._keyboardInvoked = true;
                        this.winControl.hide();
                    } else if (event.shiftKey && event.keyCode === Key.tab
                          && this === _Global.document.activeElement
                          && !event.altKey && !event.ctrlKey && !event.metaKey) {
                        event.preventDefault();
                        event.stopPropagation();
                        this.winControl._focusOnLastFocusableElementOrThis();
                    }
                },

                _handleFocusIn: function Flyout_handleFocusIn(event) {
                    if (!this.element.contains(event.relatedTarget)) {
                        Flyout._cascadeManager.handleFocusIntoFlyout(event);
                    }
                    // Else focus is only moving between elements in the flyout.
                    // Doesn't need to be handled by cascadeManager.
                },
                _handleFocusOut: function Flyout_handleFocusOut(event) {
                    if (!this.element.contains(event.relatedTarget)) {
                        Flyout._cascadeManager.handleFocusOutOfCascade(event);
                    }
                    // Else focus is only moving between elements in the flyout.
                    // Doesn't need to be handled by cascadeManager.
                },


                // Create and add a new first div as the first child
                _addFirstDiv: function Flyout_addFirstDiv() {
                    var firstDiv = _Global.document.createElement("div");
                    firstDiv.className = _Constants.firstDivClass;
                    firstDiv.style.display = "inline";
                    firstDiv.setAttribute("role", "menuitem");
                    firstDiv.setAttribute("aria-hidden", "true");

                    // add to beginning
                    if (this._element.children[0]) {
                        this._element.insertBefore(firstDiv, this._element.children[0]);
                    } else {
                        this._element.appendChild(firstDiv);
                    }

                    var that = this;
                    _ElementUtilities._addEventListener(firstDiv, "focusin", function () { that._focusOnLastFocusableElementOrThis(); }, false);

                    return firstDiv;
                },

                // Create and add a new final div as the last child
                _addFinalDiv: function Flyout_addFinalDiv() {
                    var finalDiv = _Global.document.createElement("div");
                    finalDiv.className = _Constants.finalDivClass;
                    finalDiv.style.display = "inline";
                    finalDiv.setAttribute("role", "menuitem");
                    finalDiv.setAttribute("aria-hidden", "true");

                    this._element.appendChild(finalDiv);
                    var that = this;
                    _ElementUtilities._addEventListener(finalDiv, "focusin", function () { that._focusOnFirstFocusableElementOrThis(); }, false);

                    return finalDiv;
                },

                _writeProfilerMark: function Flyout_writeProfilerMark(text) {
                    _WriteProfilerMark("WinJS.UI.Flyout:" + this._id + ":" + text);
                }
            },
            {
                _cascadeManager: new _CascadeManager(),
            });
            return Flyout;
        })
    });

});