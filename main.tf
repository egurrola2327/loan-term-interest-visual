# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  name   = "${var.project}-${var.environment}"
  suffix = random_string.suffix.result

  tags = {
    project     = var.project
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Resource group (rg)
# ---------------------------------------------------------------------------

resource "azurerm_resource_group" "rg" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags

  lifecycle {
    precondition {
      condition     = terraform.workspace == var.environment
      error_message = "Workspace and environment do not match. Run 'terraform workspace select ${var.environment}' or use the matching .tfvars file."
    }
  }
}

# ---------------------------------------------------------------------------
# Monitoring: Log Analytics workspace (law) + Application Insights (appi)
# ---------------------------------------------------------------------------

resource "azurerm_log_analytics_workspace" "law" {
  name                = "law-${local.name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = local.tags
}

resource "azurerm_application_insights" "appi" {
  name                = "appi-${local.name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  workspace_id        = azurerm_log_analytics_workspace.law.id
  application_type    = "web"
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# App Service plan (asp) + web app
# ---------------------------------------------------------------------------

resource "azurerm_service_plan" "asp" {
  name                = "asp-${local.name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "app" {
  name                = "app-${local.name}-${local.suffix}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  service_plan_id     = azurerm_service_plan.asp.id
  https_only          = true
  tags                = local.tags

  site_config {
    always_on = var.app_service_sku != "F1"

    application_stack {
      python_version = "3.11"
    }

    # Lightweight server placeholder so it doesn't crash on boot
    app_command_line = "python3 -m http.server 8000"
  }

  app_settings = {
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.appi.connection_string
    ENVIRONMENT                           = var.environment
  }
}

# ---------------------------------------------------------------------------
# Storage account (st)
# ---------------------------------------------------------------------------

resource "azurerm_storage_account" "st" {
  name                            = "st${var.project}${var.environment}${local.suffix}"
  location                        = azurerm_resource_group.rg.location
  resource_group_name             = azurerm_resource_group.rg.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = local.tags
}
