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

    it('contains BEGIN/END block', () => {
      const template = getObjectTemplate('procedure', databaseName)
      expect(template).toContain('BEGIN')
      expect(template).toContain('END')
    })

    it('contains parameter placeholder', () => {
      const template = getObjectTemplate('procedure', databaseName)
      expect(template).toContain('IN p_param1 INT')
    })

    it('contains a comment placeholder', () => {
      const template = getObjectTemplate('procedure', databaseName)
      expect(template).toContain('-- Procedure body')
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

    it('contains RETURNS clause', () => {
      const template = getObjectTemplate('function', databaseName)
      expect(template).toContain('RETURNS INT')
    })

    it('contains DETERMINISTIC keyword', () => {
      const template = getObjectTemplate('function', databaseName)
      expect(template).toContain('DETERMINISTIC')
    })

    it('contains BEGIN/END block', () => {
      const template = getObjectTemplate('function', databaseName)
      expect(template).toContain('BEGIN')
      expect(template).toContain('END')
    })

    it('contains RETURN statement', () => {
      const template = getObjectTemplate('function', databaseName)
      expect(template).toContain('RETURN p_param1')
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

    it('contains BEFORE INSERT clause', () => {
      const template = getObjectTemplate('trigger', databaseName)
      expect(template).toContain('BEFORE INSERT ON')
    })

    it('contains FOR EACH ROW', () => {
      const template = getObjectTemplate('trigger', databaseName)
      expect(template).toContain('FOR EACH ROW')
    })

    it('contains <table_name> placeholder', () => {
      const template = getObjectTemplate('trigger', databaseName)
      expect(template).toContain('<table_name>')
    })

    it('contains BEGIN/END block', () => {
      const template = getObjectTemplate('trigger', databaseName)
      expect(template).toContain('BEGIN')
      expect(template).toContain('END')
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

    it('contains ON SCHEDULE clause', () => {
      const template = getObjectTemplate('event', databaseName)
      expect(template).toContain('ON SCHEDULE EVERY 1 DAY')
    })

    it('contains BEGIN/END block', () => {
      const template = getObjectTemplate('event', databaseName)
      expect(template).toContain('BEGIN')
      expect(template).toContain('END')
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

    it('contains the database name', () => {
      const template = getObjectTemplate('view', databaseName)
      expect(template).toContain('`test_db`')
    })

    it('contains SELECT keyword', () => {
      const template = getObjectTemplate('view', databaseName)
      expect(template).toContain('SELECT 1')
    })

    it('contains AS keyword', () => {
      const template = getObjectTemplate('view', databaseName)
      expect(template).toContain('AS')
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
