/**
	* The purpose of this script is to inject CSS protection classes into the HTML code of the Media Manager window, implementing visual safeguards for the Media Guard plugin:
	* displaying an alert, overlaying padlocks and shields on folders and files, removing restricted buttons, menu options (dropdowns), and checkboxes, as well as disabling the dropzone area—
	* all applied within specified folders and for specific user groups.
*/
(function() {
	'use strict';

	// *** Start an interval to wait for configuration data from PHP.
	var checkConfigInterval = setInterval(function() {
		if (window.MediaGuardConfig && window.MediaGuardConfig.normalizedFolders) {
			clearInterval(checkConfigInterval); 
			initMediaGuard(); 
		}
	}, 10);

	// Main script function - initializes the application of visual protection when the media manager window is opened, and refreshes the protection after any significant HTML change within the folder view.
	function initMediaGuard() {
		// --- Unpack the data injected into RAM by the PHP script and prepare it for use.

		// Original array of protected folders (preserving original casing) for proper display in the Debugger. Evaluates to an empty array if no data is retrieved.
		var protectedFolders = window.MediaGuardConfig.normalizedFolders || [];
		// Flag indicating whether the debugger is enabled: true/false.
		var isDebugEnabled = window.MediaGuardConfig.isDebugger;
		// The text content of the alert displayed during protection or a configuration failure state.
		var alertMessage = window.MediaGuardConfig.alertText;
		// The text content displayed when a user lacks permission to delete a folder.
		var deleteInfo = window.MediaGuardConfig.deleteInfo;
		// Flag indicating whether a configuration failure was detected: true/false.
		var isConfigError = window.MediaGuardConfig.isConfigError;
		// Flag indicating whether the currently logged-in user should be blocked: true/false.
		var isBlockedUser = window.MediaGuardConfig.isBlockedUser;

		// An array of protected paths, normalized for comparison (converted to lowercase).
		var normalizedProtectedFolders = protectedFolders.map(function(folder) {
			return folder.toLowerCase().trim();
		});

		// Data for display (Debugger only).
		var allowedGroupsList = window.MediaGuardConfig.allowedGroups ? window.MediaGuardConfig.allowedGroups.join(', ') : 'None';
		var protectedPathsList = window.MediaGuardConfig.normalizedFolders ? window.MediaGuardConfig.normalizedFolders.join(' | ') : 'None';
		var userGroupsList = window.MediaGuardConfig.currentUserGroups ? window.MediaGuardConfig.currentUserGroups.join(', ') : 'None';
		var isCoreAdminUser = window.MediaGuardConfig.isCoreAdmin || false;

		// --- Register RAM cache variables to store dynamically changing values ​​used for filtering pulses triggered by the HTML mutation observer.

		// Cache variable storing the path of the last displayed folder.
		window.MediaGuardLastFolderPath = '';
		// Cache variable storing the total number of items in the last displayed folder.
		window.MediaGuardLastItemsCount = 0;
		// Cache variable storing the last active layout view mode: 'grid' or 'list'.
		window.MediaGuardLastViewType = '';
		// Text flag indicating that a rename operation has started, which also caches the item name currently displayed in the dialog window.
		window.MediaGuardIntentionToRenameFolder = '';

		// Function that returns the name of a folder/file while preserving the original casing, as this is required in certain scenarios.
		function extractItemName(fullPath) {
			if (!fullPath) return '';
			return fullPath.split('/').pop().replace(':', '').trim();
		}

		// Function that returns the path to the current folder displayed in the media manager, preserving the original casing of the characters.
		function getCurrentMediaManagerPath() {
			var path = '';

			// Attempt to read the current path from browser storage (sessionStorage).
			try {
				var sessionData = sessionStorage.getItem('joomla.mediamanager');
				if (sessionData) {
					path = JSON.parse(sessionData).selectedDirectory || '';
				}
			} catch(e) {}

			// Fallback (e.g., for pop-up windows when editing articles) – if the 'path' variable is empty.
			if (!path) {
				// Assign the raw, full URL from the browser's address bar to the 'path' variable.
				path = window.location.href;
			}
			return path;
		}

		// This function returns a full, normalized path to a folder/file based on the 'basePath' and 'folderName' parameters.
		function constructFolderPath(basePath, folderName) {
			if (!basePath || !folderName) return '';

			var separator = (basePath.substring(basePath.length - 1) === ':') ? '' : '/';
			var fullPath = basePath.toLowerCase().trim() + separator + folderName.toLowerCase().trim();
			if (fullPath.indexOf(':/') === -1 && fullPath.indexOf(':') !== -1) {
				fullPath = fullPath.replace(':', ':/');
			}

			// Safety check – if "://" appears, replace it with ":/" (as required by Joomla and the plugin).
			fullPath = fullPath.replace(/:\/\//g, ':/');
			return fullPath;
		}

		// This function constructs the HTML code for the debugger, ready for display.
		function buildMediaGuardDebugger() {
			// Initialize a variable for the debugger's HTML container.
			var debugDiv = document.createElement('div'); 
			debugDiv.id = 'mediaguard-advanced-debugger'; 

			// Styling the bar.
			debugDiv.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;background:#e2f0d9;color:#385723;border-top:3px solid #a9d18e;padding:12px;font-family:monospace;font-size:11px;z-index:9999999;box-sizing:border-box;line-height:1.4;';

			// Protection status flags.
			var shieldStatus = isConfigError ?
				'<span style="color:#c00000;font-weight:bold;">CRITICAL ERROR</span>' :
				'<span style="color:#2e74b5;font-weight:bold;">PROTECTION ACTIVE</span>';

			// ACL Detector.
			// The user is subject to restrictions (their group is not included in the configuration whitelist).
			var userStatusText = '<span style="color:#c00000;font-weight:bold;">RESTRICTED (Active)</span>';
			if (isCoreAdminUser) {
				// If it is a Super User (core.admin), they are never blocked, regardless of the configuration settings.
				userStatusText = '<span style="color:#375623;font-weight:bold;">BYPASSED (Super User / ACL Root)</span>';
			} else if (!isBlockedUser) {
				// If the user has unrestricted access but is not a core.admin, it means they are on the whitelist!
				userStatusText = '<span style="color:#375623;font-weight:bold;">ALLOWED ACCESS (White-listed)</span>';
			}
			if (isConfigError && !isCoreAdminUser) {
				// If this is fail-safe mode and the user is not a core.admin.
				userStatusText = '<span style="color:#c00000;font-weight:bold;">RESTRICTED (Fail-Safe)</span>';
			}

			// Inject data into the container in RAM.
			debugDiv.innerHTML =
				'<div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">' +
				'  <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr 1fr; gap: 10px; align-items: center; border-bottom: 1px solid #c8e0c0; padding-bottom: 6px;">' +
				'	 <div>🛡️ <b>Guard Mode:</b> ' + shieldStatus + '</div>' +
				'	 <div>👤 <b>Account Status:</b> ' + userStatusText + '</div>' +
				'	 <div>👤 <b>Your Group IDs:</b> <span style="background:#fff;padding:1px 5px;border:1px solid #d9d9d9;border-radius:2px;font-weight:bold;color:#444;">[' + userGroupsList + ']</span></div>' +
				'	 <div>👥 <b>Allowed Group IDs:</b> <span style="background:#fff;padding:1px 5px;border:1px solid #d9d9d9;border-radius:2px;font-weight:bold;color:#2e74b5;">[' + allowedGroupsList + ']</span></div>' +
				'  </div>' +
				'  <div style="text-align: left; white-space: pre-wrap !important; word-break: break-all !important; line-height: 1.4 !important; max-height: 80px !important; overflow-y: auto !important; padding-right: 5px;">' +
				'	 🔒 <b>Protected Targets Matrix:</b> <span style="color:#555;font-style:italic;">' + protectedPathsList + '</span>' +
				'  </div>' +
				'</div>';

			// Display the finished element on the screen.
			document.body.appendChild(debugDiv); 
			document.body.style.setProperty('margin-bottom', '140px', 'important'); 
		}

		// This function applies a Drag & Drop block to the Dropzone area within a protected (locked) folder.
		function activateOuterDragDropShield() {
			var preventProtectedDrop = function(e) {
				 // Check if the protected zone class is present on the body tag.
				 if (document.body.classList.contains('mediaguard-locked-zone')) {
					 e.preventDefault(); 
					 e.stopPropagation(); 
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none'; 
					}
					return false;
				}
			};
			window.addEventListener('dragenter', preventProtectedDrop, true);
			window.addEventListener('dragover', preventProtectedDrop, true);
			window.addEventListener('drop', preventProtectedDrop, true);
		}

		// This function examines the protection status of a folder normalized for comparison against targetPath—and returns one of four possible states: free, parent, locked, or child.
		var getMediaGuardFolderState = function(targetPath) {
			if (typeof normalizedProtectedFolders === 'undefined' || normalizedProtectedFolders.length === 0 || !targetPath) {
				return 'free';
			}
			if (isConfigError === true) {
				return 'locked';
			}

			// The searchParentPattern variable is used exclusively for checking the 'parent' status in condition #3.
			var searchParentPattern = targetPath.endsWith('/') ? targetPath : targetPath + '/';
			var matchedState = 'free';
			normalizedProtectedFolders.some(function(protectedPath) {

				if (protectedPath === '') return false; 

				// 1. Protected folder case
				if (protectedPath === targetPath || targetPath === protectedPath.replace(':/', ':')) {
					matchedState = 'locked';
					return true; 
				}

				// 2. Child case (descendant of a protected folder) – the folder being checked is located somewhere inside a protected folder.
				if (targetPath.indexOf(protectedPath + '/') === 0) {
					matchedState = 'child';
					return true; 
				}

				// 3. Parent case (ancestor of a protected folder) – the folder being checked is higher up in the directory tree and contains at least one protected folder somewhere further down.
				if (protectedPath.startsWith(searchParentPattern)) {
					matchedState = 'parent';
					return false; 
				}

				return false;
			});
			return matchedState;
		};

		// This function modifies the HTML of the currently displayed grid or list view of folders/files by adding or removing the appropriate protection classes.
		var processVisibleItemsUX = function(currentFolderId) {
			if (!isBlockedUser || !currentFolderId) return;

			// Normalize the path to the current folder (the one the user is currently in).
			var normalizedFolder = currentFolderId.toLowerCase().trim();
			// Path to subfolders located within the folder.
			var baseFolder = normalizedFolder.replace(/\/$/, '');

			// --- RESET PROTECTED ZONE CLASS on <body>
			document.body.style.removeProperty('--mediaguard-alert');
			document.body.style.removeProperty('--mediaguard-shadow');
			document.body.classList.remove('mediaguard-locked-zone');

			// Determine the required protection status for the current folder.
			var folderState = getMediaGuardFolderState(normalizedFolder);

			// --- OPTIMIZATION – EXCLUDING A FOLDER FROM SCANNING (FULLY EXEMPT)
			// If the folder is completely unrestricted, exit the function. Do not apply any protection class to this folder or any of its subfolders.
			if (folderState === 'free') {
				return; 
			}

			// --- OPTIMIZATION – APPLYING FULL PROTECTION WITHIN A PROTECTED FOLDER
			// If the folder is protected or a descendant of a protected folder, apply the 'locked-zone' protection class and the corresponding properties to the <body> of the manager window, then exit the function.
			if (folderState === 'locked' || folderState === 'child') {
				document.body.style.setProperty('--mediaguard-alert', '"' + alertMessage + '"');
				if (isConfigError) {
					document.body.style.setProperty('--mediaguard-shadow', '0 0 10px rgba(220,53,69,0.4)');
				}
				document.body.classList.add('mediaguard-locked-zone');
				return;
			}

			// --- SELECTIVE PROTECTION OF INDIVIDUAL FOLDERS WITHIN THE PARENT ZONE
			// Create an 'items' array containing the HTML elements that display subfolders located inside the current folder.
			var items = document.querySelectorAll(
				'.media-browser-item-directory, ' + 
				'div[class*="media-browser-item-directory"], ' + 
				'tr.media-browser-item:has(td.type[data-type=""]), ' + 
				'tr.media-browser-item:has([data-type=""])' 
			);
			items.forEach(function(item) {
				// Retrieve the HTML element from the current item that displays the folder name and store it in the variable titleEl.
				var titleEl = item.querySelector('.media-browser-item-info, th.name, .media-grid-item__title, .name');

				// Remove protection-related classes from the tiles or table rows.
				item.classList.remove('mediaguard-locked-directory', 'mediaguard-parent-directory');
				if (titleEl) {
				   titleEl.classList.remove('mediaguard-locked-directory', 'mediaguard-parent-directory');
				}

				if (titleEl) {
					// From the retrieved HTML element, extract the folder name in a normalized version (lowercase).
					var rawText = titleEl.textContent || titleEl.innerText || '';
					rawText = rawText.trim(); 
					var itemName = rawText.toLowerCase();

					if (itemName) {
						// Construct the normalized path for the folder (itemName) to compare it against the defined, normalized paths of protected folders.
						var fullItemUrl = constructFolderPath(baseFolder, itemName);

						// Apply the appropriate protection-related classes to each item.
						var itemState = getMediaGuardFolderState(fullItemUrl);
						if (itemState === 'locked' || itemState === 'child') {
							if (item.tagName.toLowerCase() === 'tr') {
								if (titleEl) titleEl.classList.add('mediaguard-locked-directory');
							} else {
								item.classList.add('mediaguard-locked-directory');
							}
						}

						if (itemState === 'parent') {
							if (item.tagName.toLowerCase() === 'tr') {
								if (titleEl) titleEl.classList.add('mediaguard-parent-directory');
							} else {
								item.classList.add('mediaguard-parent-directory');
							}
						}
					}
				}
			});
		};

		// This function filters events sent from the mutation observer, which triggers a refresh of the Media Manager protection via the processVisibleItemsUX function.
		// It is invoked by an observer that detects DOM changes made by the Vue.js engine.
		var enforceMediaGuardFilter = function() {
			// Retrieve the path to the current folder using the helper function getCurrentMediaManagerPath().
			var currentFolderId = getCurrentMediaManagerPath();

			// Get the current number of items (folders or files) — tiles in grid view or rows in table view, within the current folder.
			var currentItemsCount = document.querySelectorAll('.media-browser-item').length;

			// --- Determine the current rendering mode used by Vue.js. Store either 'grid' or 'list'.
			var currentViewType = '';
			if (document.querySelector('.media-browser-grid')) {
				currentViewType = 'grid';
			} else if (document.querySelector('.media-browser-table')) {
				currentViewType = 'list';
			} else if (currentItemsCount === 0 && window.MediaGuardLastViewType !== '') {
				currentViewType = window.MediaGuardLastViewType;
			}

			// --- Detect folder renaming.
			// Detect whether a rename dialog window is displayed on the screen.
			var isRenamingWindow = false; 
			if (document.getElementById('renameTitle')) {
				var isRenamingWindow = true;
				var renameInput = document.getElementById('name');
				if (renameInput) {
					// Get the raw value from the input and trim whitespace, while preserving the original casing for comparison against the raw code retrieved from the HTML.
					var extractedName = renameInput.value.trim();
					if (extractedName !== '') {
						window.MediaGuardIntentionToRenameFolder = extractedName;
					}
				}
			}

			// --- Detect whether a folder rename has occurred.
			var isRenameSuccess = false; 
			// Check if a rename operation has been initiated (indicated by the presence of an old/new folder name).
			if (window.MediaGuardIntentionToRenameFolder !== '') {
				// Detect whether a green notification bar indicating a successful rename is displayed on the screen.
				var isRenameSuccessInfo = false; 
				if (document.querySelector('joomla-alert[type="success"]')) {
					isRenameSuccessInfo = true;
				}

				// Check if a folder tile or row with the new name has appeared on the screen.
				var targetSearchName = window.MediaGuardIntentionToRenameFolder;
				var xpathExpression = "//th[@class='name'][text()='" + targetSearchName + "'] | //div[@class='media-browser-item-info'][text()='" + targetSearchName + "']";
				var resultElement = document.evaluate(xpathExpression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
				if (isRenameSuccessInfo && resultElement) {
					// Raise the success flag so it can be read in the filter.
					isRenameSuccess = true;
				}

				if (!isRenamingWindow && !isRenameSuccessInfo) {
					// Reset the rename-intent flag so that it does not lead to errors during subsequent pulses.
					window.MediaGuardIntentionToRenameFolder = '';
				}
			}

			// --- Suppress irrelevant mutation signals that do not require updating the protection classes.

			// Filter 1 - Suppress signals after initialization until the full view of folders and files appears.
			if (currentItemsCount === 0 && window.MediaGuardLastFolderPath === '') {
				return;
			}

			// Filter 2 - Suppress signals triggered by DOM mutations that do not reflect significant changes.
			if (currentFolderId === window.MediaGuardLastFolderPath &&
				currentItemsCount === window.MediaGuardLastItemsCount &&
				currentViewType === window.MediaGuardLastViewType &&
				!isRenameSuccess) {
				return;
			}

			// The impulse passed through the filters.

			// Save the current state as a baseline for comparison against the next signal.
			window.MediaGuardLastFolderPath = currentFolderId;
			window.MediaGuardLastItemsCount = currentItemsCount;
			window.MediaGuardLastViewType	= currentViewType;
			window.MediaGuardIntentionToRenameFolder = '';

			// --- Apply the appropriate protection classes to the currently displayed folder in the Media Manager.
			processVisibleItemsUX(currentFolderId);
		};

		// This function signals the filter whenever the asynchronous Vue.js engine in Joomla modifies the Media Manager DOM.
		// (e.g., changing folders, renaming, creating folders, uploading, deleting, scrolling, or using the search function).
		var mediaObserver = new MutationObserver(function() {
			if (document.querySelector('.media-browser, .media-browser-item, tr.media-browser-item, joomla-media-browser')) {
				enforceMediaGuardFilter();
			}
		});

		// =============================================
		// -------- MAIN INITIALIZATION RUNTIME --------
		// =============================================

		// Display the debugger if it is enabled.
		if (isDebugEnabled) {
			buildMediaGuardDebugger();
		}

		// Launch visual protection only if the user is blocked OR if there is a configuration error! Otherwise, protection should remain inactive.
		if (isBlockedUser || isConfigError) {
			// Enable the observer (photocell-like sensor) in the background.
			mediaObserver.observe(document.body, {
				childList: true,
				subtree: true
			});

			// Activate Drag & Drop protections.
			activateOuterDragDropShield();

			// Launch the visual alert injector.
			window.addEventListener('click', function() {
				setTimeout(function() {
					var confirmModal = document.querySelector('.joomla-modal, .modal, .bootbox-confirm, joomla-render-modal');
					if (confirmModal) {
						// Check if any of the items selected by the user are locked or parent directories.
						var isParentSelected = document.querySelector(
							'.mediaguard-locked-directory.selected, ' +
							'.mediaguard-parent-directory.selected, ' +
							'[class*="selected"] .mediaguard-locked-directory, ' +
							'[class*="selected"] .mediaguard-parent-directory'
						);

						if (isParentSelected) {
							// Replace the standard Joomla confirmation message in the dialog box with a custom notification stating that the operation is blocked.
							var alertTxt = deleteInfo || "Operation not allowed!";
							var modalBody = confirmModal.querySelector('.modal-body, .bootbox-body');
							if (modalBody) {
								modalBody.innerHTML = '<div style="color: #dc3545; font-weight: bold; padding: 10px; border-left: 4px solid #dc3545; background-color: #f8d7da; border-radius: 4px; font-family: sans-serif; font-size: 14px;">⚠️ ' + alertTxt + '</div>';
							}

							// Remove the "confirm deletion" button from the window entirely. Only "Cancel" should remain.
							var dangerSubmitBtn = confirmModal.querySelector('button.btn-danger, button.btn-primary, button[data-bb-handler="confirm"], .modal-footer button:last-child');
							if (dangerSubmitBtn) {
								dangerSubmitBtn.style.setProperty('display', 'none', 'important');
							}
						}
					}
				}, 10); // Added a short delay to ensure the modal is rendered in the DOM
			});
		}
	} 
})();