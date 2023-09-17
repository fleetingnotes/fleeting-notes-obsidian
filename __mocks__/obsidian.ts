export const moment = jest.fn(() => {
    return {
      local: () => {
        return {
          format: (dateFormat: string) => {
            // Define your desired mock behavior here
            return '2023-09-15T12:00:00';
          },
        };
      },
    };
  });

  export class App {
  }
  
  export class Modal {
  }
  
  export class Setting {
  }