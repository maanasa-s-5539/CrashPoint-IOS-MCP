export interface AutomationTemplate {
    filename: string;
    content: string;
    executable: boolean;
}
export interface FullCrashPointConfig {
    CRASH_ANALYSIS_PARENT: string;
    CLAUDE_CLI_PATH?: string;
    DSYM_PATH?: string;
    APP_PATH?: string;
    APP_NAME?: string;
    MASTER_BRANCH_PATH?: string;
    DEV_BRANCH_PATH?: string;
    CRASH_VERSIONS?: string;
    CRASH_DATE_OFFSET?: string;
    APP_DISPLAY_NAME?: string;
    APPTICS_MCP_NAME?: string;
    PROJECTS_MCP_NAME?: string;
    ZOHO_CLIQ_WEBHOOK_URL?: string;
    ZOHO_PROJECTS_MCP_URL?: string;
    ZOHO_PROJECTS_PORTAL_ID?: string;
    ZOHO_PROJECTS_PROJECT_ID?: string;
    ZOHO_BUG_STATUS_OPEN?: string;
    ZOHO_BUG_APP_VERSION?: string;
    ZOHO_BUG_NUM_OF_OCCURRENCES?: string;
    SCHEDULED_RUN_TIME?: string;
}
export declare function generateMcpJson(config: FullCrashPointConfig): string;
export declare function generatePlist(config: FullCrashPointConfig): string;
export declare function getAutomationTemplates(parentDir: string): AutomationTemplate[];
//# sourceMappingURL=automationTemplates.d.ts.map