export interface FullCrashPointConfig {
    CRASH_ANALYSIS_PARENT: string;
    CLAUDE_CLI_PATH?: string;
    DSYM_PATH?: string;
    APP_PATH?: string;
    APP_NAME?: string;
    MASTER_BRANCH_PATH?: string;
    DEV_BRANCH_PATH?: string;
    CRASH_VERSIONS?: string;
    CRASH_NUM_DAYS?: string;
    CRASH_DATE_OFFSET?: string;
    CRASH_INPUT_DIR?: string;
    APP_DISPLAY_NAME?: string;
    APPTICS_MCP_NAME?: string;
    APPTICS_PORTAL_ID?: string;
    APPTICS_PROJECT_ID?: string;
    APPTICS_APP_NAME?: string;
    ZOHO_CLIQ_WEBHOOK_URL?: string;
    ZOHO_PROJECTS_PORTAL_ID?: string;
    ZOHO_PROJECTS_PROJECT_ID?: string;
    ZOHO_BUG_STATUS_OPEN?: string;
    ZOHO_BUG_STATUS_FIXED?: string;
    ZOHO_BUG_SEVERITY_SHOWSTOPPER?: string;
    ZOHO_BUG_SEVERITY_CRITICAL?: string;
    ZOHO_BUG_SEVERITY_MAJOR?: string;
    ZOHO_BUG_SEVERITY_MINOR?: string;
    ZOHO_BUG_SEVERITY_NONE?: string;
    ZOHO_BUG_APP_VERSION?: string;
    ZOHO_BUG_NUM_OF_OCCURRENCES?: string;
    SCHEDULED_RUN_TIME?: string;
}
export declare function generateMcpJson(config: FullCrashPointConfig): string;
export declare function generatePlist(config: FullCrashPointConfig): string;
//# sourceMappingURL=automationTemplates.d.ts.map