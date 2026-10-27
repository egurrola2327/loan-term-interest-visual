terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id                 = "53eaa60a-7a7b-436a-8213-9fb016dcb873"
  resource_provider_registrations = "none"
}