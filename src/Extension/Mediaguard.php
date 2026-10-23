<?php
/**
	* --- MEDIAGUARD SYSTEM EXTENSION FOR JOOMLA 5/6 ---
	* A fully optimized, RAM-cached Media Manager protection plugin.
*/
namespace Joomla\Plugin\System\Mediaguard\Extension;

defined('_JEXEC') or die;

use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\CMS\Factory;
use Joomla\CMS\Language\Text;
use Joomla\Event\SubscriberInterface;

class Mediaguard extends CMSPlugin
{
	// Plugin configuration array cached in RAM
	private $mgConfig = null;

	// This function retrieves configuration from the Joomla database and calculates the necessary control parameters.
	private function loadPluginConfig()
	{
		// Safety check: If the function has already been called during this cycle, do nothing.
		if ($this->mgConfig !== null) {
			return $this->mgConfig;
		}

		// ---- 1. PROCESSING AND SYNTAX VALIDATION OF DEFINED PROTECTED FOLDERS

		// Retrieve the text containing defined protected folders from the database.
		$rawFoldersText = $this->params->get('protected_folders', '');

		// Convert the text into an array consisting of individual lines.
		$foldersLines = explode("\n", str_replace("\r", "", $rawFoldersText));
		$rawFoldersArray = [];

		// Flag to track folder path syntax validity.
		$isFoldersSyntaxValid = true;
		foreach ($foldersLines as $line) {
			$trimmed = trim($line);

			if (!empty($trimmed)) {
				// Check if the line contains only allowed, safe path characters: letters, numbers, slashes (/, \), hyphens (-), underscores (_), spaces, and dots (.).
				if (!preg_match('/^[a-zA-Z0-9\/\\\\\._ -]+$/', $trimmed)) {
					$isFoldersSyntaxValid = false;
				}

				$folder = str_replace('\\', '/', $trimmed);
				$folder = trim($folder, '/');
				$parts = explode('/', $folder);
				$rootAdapter = array_shift($parts);
				$subPath = implode('/', $parts);

				if (empty($subPath)) {
					// If it is a root folder (e.g., "images" or "files").
					$rawFoldersArray[] = 'local-' . $rootAdapter . ':';
				} else {
					// If it is a regular subfolder.
					$rawFoldersArray[] = 'local-' . $rootAdapter . ':/' . $subPath;
				}
			}
		}

		$rawFoldersArray = array_values(array_filter($rawFoldersArray));

		// ---- 2. PROCESSING AND SYNTAX VALIDATION OF DEFINED EXEMPT GROUPS

		// Retrieve and clean the raw string (whitelist of groups) from the Joomla database.
		$processedGroupsText = trim($this->params->get('allowed_groups', ''));
		if (substr($processedGroupsText, -1) === ',') {
			$processedGroupsText = substr($processedGroupsText, 0, -1);
			$processedGroupsText = trim($processedGroupsText);
		}

		// Check the syntax validity of the defined groups that are exempt from restrictions (whitelist). Accepted formats include "1,2,9" or "1, 2, 9" (allowing for spaces after commas).
		$isGroupsSyntaxValid = (bool) preg_match('/^[1-9][0-9]*(\s*,\s*[1-9][0-9]*)*$/', $processedGroupsText);
		$cleanGroupsArray = [];

		// If the syntax is valid, parse the string into a clean array of numbers.
		if ($isGroupsSyntaxValid && $processedGroupsText !== '') {
			$groupsParts = explode(',', $processedGroupsText);
			foreach ($groupsParts as $part) {
				$cleanGroupsArray[] = (int)$part;
			}
		}

		// --- 3. FILE INTEGRITY DETECTION (FATAL ERROR / HTTP 500)

		// Base path to JS and CSS assets.
		$pluginPath   = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR;
		$mediaSubPath = 'media' . DIRECTORY_SEPARATOR;

		// Clear the server's filesystem stat cache for these two core assets.
		foreach (['mediaguard.js', 'mediaguard.css'] as $file) {
			clearstatcache(true, $pluginPath . $mediaSubPath . $file);
		}

		// Verify the physical existence of the files within the dedicated 'media' subfolder.
		$jsExists  = file_exists($pluginPath . $mediaSubPath . 'mediaguard.js');
		$cssExists = file_exists($pluginPath . $mediaSubPath . 'mediaguard.css');

		if (!$jsExists || !$cssExists) {
			// Prepare the content for a 500 error message.
			$missingFiles = [];
			if (!$jsExists)	 $missingFiles[] = 'media/mediaguard.js';
			if (!$cssExists) $missingFiles[] = 'media/mediaguard.css';
			$missingList = implode(', ', $missingFiles);

			// Force TOTAL INTEGRITY SHUTDOWN:
			throw new \RuntimeException(
				'CRITICAL ERROR [Fatal]: MediaGuard integrity violation. ' .
				'The required frontend resource(s) [' . $missingList . '] are missing from the server. ' .
				'Please check your FTP directory.',
				500
			);
		}

		// --- 4. DETECTION OF DATABASE FAILURE STATE / INCORRECT ENTRIES

		$isConfigError = false;

		// Validate that parameters exist and no syntax errors were flagged.
		if (empty($rawFoldersArray) || empty($cleanGroupsArray) || !$isGroupsSyntaxValid || !$isFoldersSyntaxValid) {
			$isConfigError = true;
		} else {
			$isConfigError = false;
		}

		// ---- 5. DETERMINING ALERT CONTENT

		// Retrieve the alert content defined in the configuration from the database.
		$alertText = trim($this->params->get('alert_text', ''));
		if (empty($alertText)) {
			// If it is empty (not specified), load the default alert from the language file.
			$alertText = Text::_('PLG_SYSTEM_MEDIAGUARD_ALERT_PROTECTED');
		}

		if ($isConfigError) {
			// Change the alert text to a failure message indicating configuration errors.
			$alertText = Text::_('PLG_SYSTEM_MEDIAGUARD_DB_ERROR');
		}

		// ---- 6. RETRIEVING THE MESSAGE CONTENT REGARDING THE PROHIBITION OF FOLDER DELETION

		$deleteInfo = Text::_('PLG_SYSTEM_MEDIAGUARD_DELETE_PROTECTED_FOLDER');

		// ---- 7. NORMALIZING DEBUG MODE

		$isDebugNormalized = false;

		// Retrieve the raw debugger configuration value from the database.
		$rawDebugValue = $this->params->get('debug_mode', 0);

		// Cast the raw value to a boolean.
		$isDebugNormalized = ($rawDebugValue == 1 || $rawDebugValue === true);

		// --- 8. DETERMINING USER IDENTITY AND PERMISSIONS (JOOMLA NATIVE ACL)

		// Retrieve the user ID in Joomla.
		$user = Factory::getApplication()->getIdentity();

		// Retrieve an array of groups to which the user belongs.
		$userGroups = $user ? $user->getAuthorisedGroups() : array();

		// Check if the user possesses native Joomla Super User permissions.
		$isCoreAdmin = $user ? $user->authorise('core.admin') : false;

		// Check if the user should be blocked.
		$isBlockedUser = $this->shouldBlockUser($isConfigError, $userGroups, $isCoreAdmin, $cleanGroupsArray);

		// --- 9. SAVING TO THE CONFIGURATION PARAMETERS ARRAY FOR PROTECTION

		$this->mgConfig = [
			'isConfigError'		=> $isConfigError,
			'isDebugger'		=> $isDebugNormalized,
			'alertText'			=> $alertText,
			'deleteInfo'		=> $deleteInfo,
			'isBlockedUser'		=> $isBlockedUser,
			'isCoreAdmin'		=> $isCoreAdmin,
			'allowedGroups'		=> $cleanGroupsArray,
			'normalizedFolders' => $rawFoldersArray,
			'currentUserGroups' => array_values($userGroups)
		];
		return $this->mgConfig;
	}

	// This function returns true if the user should be blocked, or false otherwise.
	private function shouldBlockUser($isConfigError, $userGroups, $isCoreAdmin, array $allowedGroups): bool
	{
		if ($isCoreAdmin === true) {
			return false;
		}
		if ($isConfigError === true) {
			return true;
		}

		// Check if the user should be blocked in normal mode.
		foreach ($userGroups as $groupId) {
			if (in_array($groupId, $allowedGroups)) {
				return false;
			}
		}
		// If all user groups have been checked and none are on the whitelist -> apply a block!
		return true;
	}

	// This function returns true if the current folder is a protected folder, or false otherwise.
	// Analysis is based on the folder path provided in the request URL (via the $input object) and the array of protected folders from $mgConfig.
	private function isProtectedFolder($input): bool
	{
		$matched = false;

		// Retrieve the current folder path passed via the &path parameter in the URL.
		$rawUrlPath = $input->get('path', '', 'raw');

		// Fallback: if 'path' is empty, check the 'id' variable (used for forms).
		if (empty($rawUrlPath)) {
			$rawUrlPath = $input->get('id', '', 'raw');
		}

		if (!empty($rawUrlPath) && is_string($rawUrlPath)) {
			$rawPath = urldecode($rawUrlPath);
			$decoded = base64_decode($rawPath, true);

			if ($decoded !== false && base64_encode($decoded) === $rawPath) {
				$rawPath = $decoded;
			}
			$normalizedPath = str_replace('\\', '/', $rawPath);

			// Normalize the path according to the standard used throughout the plugin for case-insensitive path comparison (following Joomla's logic: 'Articles' and 'articles' are the same folder).
			$normalizedPathLower = strtolower(trim($normalizedPath));

			// Determine whether the request targets a file or a folder.
			$isTargetAFile = (strpos(basename($normalizedPathLower), '.') !== false);

			// If it is a file, remove the filename, leaving only the parent directory (dirname) for verification.
			if ($isTargetAFile) {
				$normalizedPathLower = dirname($normalizedPathLower);
			}

			// Retrieve the previously mapped list of protected folders from the $mgConfig class array stored in RAM.
			$protectedFoldersList = isset($this->mgConfig['normalizedFolders']) ? $this->mgConfig['normalizedFolders'] : array();

			// Identify the HTTP method of the REST request (PUT / DELETE / POST).
			$httpMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

			// Iterate through the list of protected folders and check if any of them match the path of the current folder from the request.
			foreach ($protectedFoldersList as $protectedFolder) {
				$patternLower = strtolower(trim($protectedFolder));

				// Check for a match: is the current folder identical to a protected one, is it a subdirectory (child) of a protected one, or is it a protected root directory?
				$isChildOrEqual = ($normalizedPathLower === $patternLower ||
								   strpos($normalizedPathLower, $patternLower . '/') === 0 ||
								   $normalizedPathLower === rtrim($patternLower, ':'));

				// FULL PROTECTION: The user is located within a protected folder or any of its subdirectories (children).
				if ($isChildOrEqual) {
					return true;
				}

				// Since it is not a protected folder, continue checking for a match: is the folder a parent of a protected folder (i.e., part of the path leading to it)?

				// LOGICAL SAFEGUARD: A file can never act as a parent directory.
				// If the request target is a file, skip it! A file located outside a protected zone is never considered protected.
				if (!$isTargetAFile) {
					$isParentFolder = (strpos($patternLower, $normalizedPathLower . '/') === 0);

					// PARTIAL PROTECTION (PARENT): The user is located in one of the parent folders on the path to a protected folder.
					if ($isParentFolder) {
						if ($httpMethod === 'DELETE' || $httpMethod === 'PUT') {
							return true;
						}
					}
				}
			}
		}
		return $matched;
	}

	// Joomla system plugin event - this function intercepts all data modification methods (POST, DELETE, PATCH, PUT) and blocks access to protected zones.
	public function onAfterInitialise()
	{
		$app = $this->getApplication();
		$input = $app->getInput();

		// If the request does not concern com_media, exit the function.
		if ($input->get('option') !== 'com_media') {
			return;
		}

		// Load the plugin's local language file.
		$lang = Factory::getLanguage();
		$lang->load('plg_system_mediaguard', JPATH_PLUGINS . '/system/mediaguard', $lang->getTag(), true);

		// Load the plugin configuration and calculate the necessary control parameters.
		$this->loadPluginConfig();

		// Array of forbidden methods.
		$forbiddenMethods = array('POST', 'DELETE', 'PATCH', 'PUT');

		// Determine the request method used to call the page.
		$currentMethod = $app->isClient('site') ? $_SERVER['REQUEST_METHOD'] : $input->getMethod();

		// If the current method is not in the list of forbidden methods, exit the function—the block will not be applied.
		if (!in_array($currentMethod, $forbiddenMethods)) {
			return;
		}

		// If the request involves a forbidden method, proceed with further checks.

		// If a failure state has been detected and the user is not a Super User.
		if ($this->mgConfig['isConfigError'] === true && $this->mgConfig['isCoreAdmin'] === false) {
			// Display a database error message indicating that access to the requested resource is denied (403 Forbidden).
			throw new \Exception(Text::_('PLG_SYSTEM_MEDIAGUARD_DB_ERROR'), 403);
		}

		// Check if the user is subject to plugin restrictions.
		if ($this->mgConfig['isBlockedUser']) {
			// If so, check whether the current folder is a protected folder.
			$isCurrentFolderProtected = $this->isProtectedFolder($input);

			// If folder is protected, display the appropriate messages and abort (Error 403).
			if ($isCurrentFolderProtected) {
				if (ob_get_contents()) {
					ob_end_clean();
				}
				header('Content-Type: application/json; charset=utf-8');
				$app->setHeader('status', '403 Forbidden', true);
				http_response_code(403);

				// A standard access-denied message in JSON format for the Joomla asynchronous API.
				echo json_encode(array(
					'success' => false,
					'message' => Text::_('PLG_SYSTEM_MEDIAGUARD_ERROR_DENIED')
				));
				die();
			}
		}
	}

	// Joomla system plugin event – this function loads CSS and JS files, and retrieves parameters—stored in the $myConfig array, that control the display of the Media Manager's visual protection, passing them to the JS file.
	public function onBeforeCompileHead()
	{
		$app = $this->getApplication();
		$input = $app->getInput();

		// If the request does not concern com_media, exit the function.
		if ($input->get('option') !== 'com_media') {
			return;
		}

		if ($this->mgConfig !== null) {

			// Visual protection is applied only if the user is to be blocked, a plugin error has occurred, or the debugger is enabled.
			if ($this->mgConfig['isBlockedUser'] === true || $this->mgConfig['isConfigError'] === true || $this->mgConfig['isDebugger'] === true) {

				// 1. Inject the configuration code—retrieved from $myConfig—into the <head> section using the helper function injectMediaGuardToFrontend().
				$this->injectMediaGuardToFrontend();

				// 2. Retrieve the Joomla 5/6 Web Asset Manager for the document.
				$wa = $app->getDocument()->getWebAssetManager();

				// 3. Register and load the CSS file via the Joomla Web Asset Manager.
				$wa->registerStyle('plg_system_mediaguard_css', 'plugins/system/mediaguard/media/mediaguard.css');
				$wa->useStyle('plg_system_mediaguard_css');

				// 4. Register and enable the JavaScript file (which manages the protection classes for the <body> element).
				$wa->registerScript('plg_system_mediaguard', 'plugins/system/mediaguard/media/mediaguard.js', array(), array(), array());
				$wa->useScript('plg_system_mediaguard');
			}
		}
	}

	// This function retrieves the prepared, cached data from the $this->mgConfig array and injects it into the JavaScript code as a global window.MediaGuardConfig object.
	private function injectMediaGuardToFrontend()
	{
		$doc = Factory::getApplication()->getDocument();
		$doc->addScriptDeclaration("
			window.MediaGuardConfig = {
				isDebugger: " . ($this->mgConfig['isDebugger'] ? 'true' : 'false') . ",
				isConfigError: " . ($this->mgConfig['isConfigError'] ? 'true' : 'false') . ",
				isCoreAdmin: " . ($this->mgConfig['isCoreAdmin'] ? 'true' : 'false') . ",
				isBlockedUser: " . ($this->mgConfig['isBlockedUser'] ? 'true' : 'false') . ",
				alertText: " . json_encode($this->mgConfig['alertText']) . ",
				deleteInfo: " . json_encode($this->mgConfig['deleteInfo']) . ",
				allowedGroups: " . json_encode($this->mgConfig['allowedGroups']) . ",
				normalizedFolders: " . json_encode($this->mgConfig['normalizedFolders']) . ",
				currentUserGroups: " . json_encode(array_values($this->mgConfig['currentUserGroups'])) . "
			};
		");
	}
}