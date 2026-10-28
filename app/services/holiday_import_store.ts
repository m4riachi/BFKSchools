import ImportStore from '#services/import_store'
import app from '@adonisjs/core/services/app'

/**
 * Uploaded/downloaded ICS calendars between "preview" and "confirm"
 * (tmp/imports/holidays), separate from the family CSV imports so an id of
 * one kind can never be confirmed on the other's route.
 */
export default class HolidayImportStore extends ImportStore {
  protected get directory() {
    return app.tmpPath('imports', 'holidays')
  }
}
