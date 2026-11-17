import { describe, it, expect } from 'vitest'
import { getObjectTemplate } from '../../../components/object-editor/object-editor-templates'
import type { EditableObjectType } from '../../../types/schema'

describe('getObjectTemplate', () => {
  const databaseName = 'test_db'

  describe('procedure template', () => {
    it('contains CREATE PROCEDURE keyword', () => {
      const template = getObjectTemplate('procedure', databaseName)
      expect(template).toContain('CREATE PROCEDURE')
    })

    it('contains the database name', () => {
      const template = getObjectTemplate('procedure', databaseName)
      expect(template).toContain('`test_db`')
    })
  })

  describe('function template', () => {
    it('contains CREATE FUNCTION keyword', () => {
      const template = getObjectTemplate('function', databaseName)
      expect(template).toContain('CREATE FUNCTION')
    })

    it('contains the database name', () => {
      const template = getObjectTemplate('function', databaseName)
      expect(template).toContain('`test_db`')
    })
  })

  describe('trigger template', () => {
    it('contains CREATE TRIGGER keyword', () => {
      const template = getObjectTemplate('trigger', databaseName)
      expect(template).toContain('CREATE TRIGGER')
    })

    it('contains the database name', () => {
      const template = getObjectTemplate('trigger', databaseName)
      expect(template).toContain('`test_db`')
    })
  })

  describe('event template', () => {
    it('contains CREATE EVENT keyword', () => {
      const template = getObjectTemplate('event', databaseName)
      expect(template).toContain('CREATE EVENT')
    })

    it('contains the database name', () => {
      const template = getObjectTemplate('event', databaseName)
      expect(template).toContain('`test_db`')
    })
  })

  describe('view template', () => {
    it('contains CREATE VIEW keyword', () => {
      const template = getObjectTemplate('view', databaseName)
      expect(template).toContain('CREATE VIEW')
    })

    it('does NOT contain CREATE OR REPLACE VIEW', () => {
      const template = getObjectTemplate('view', databaseName)
      expect(template).not.toContain('CREATE OR REPLACE VIEW')
    })
  })

  describe('database name substitution', () => {
    it('uses the provided database name for all types', () => {
      const types: EditableObjectType[] = ['view', 'procedure', 'function', 'trigger', 'event']
      for (const type of types) {
        const template = getObjectTemplate(type, 'my_custom_db')
        expect(template).toContain('`my_custom_db`')
      }
    })
  })
})
